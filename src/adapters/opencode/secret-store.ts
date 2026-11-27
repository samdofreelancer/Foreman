import type { SecretStore } from "../../application/ports/secret-store"
import { spawn } from "node:child_process"

/** Process-lifetime fallback. Secrets are intentionally never written to SQLite or browser storage. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()
  get storageMode() { return "process-memory" as const }
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: string) { this.values.set(key, value) }
  async delete(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

type PowerShellRunner = (input: string) => Promise<string>

/** Windows Credential Manager adapter. Secret material is sent over stdin, never argv. */
export class WindowsCredentialStore implements SecretStore {
  get storageMode() { return "os-vault" as const }
  constructor(private readonly run: PowerShellRunner = runPowerShell) {}

  async get(key: string): Promise<string | undefined> {
    const output = await this.run(JSON.stringify({ op: "get", target: targetName(key) }))
    return output === "NOT_FOUND" ? undefined : Buffer.from(output, "base64").toString("utf8")
  }

  async set(key: string, value: string): Promise<void> {
    if (Buffer.byteLength(value, "utf16le") > 2_560) throw new Error("Windows Credential Manager secret exceeds 2560 bytes")
    await this.run(JSON.stringify({ op: "set", target: targetName(key), value }))
  }

  async delete(key: string): Promise<void> {
    await this.run(JSON.stringify({ op: "delete", target: targetName(key) }))
  }
}

export class FallbackSecretStore implements SecretStore {
  private fallbackActive = false
  constructor(private readonly primary: SecretStore, private readonly fallback: SecretStore) {}
  get storageMode() { return this.fallbackActive ? "process-memory" : "os-vault" }
  async get(key: string) {
    try { if (!this.fallbackActive) return await this.primary.get(key) }
    catch { this.fallbackActive = true }
    return this.fallback.get(key)
  }
  async set(key: string, value: string) {
    try { if (!this.fallbackActive) return await this.primary.set(key, value) }
    catch { this.fallbackActive = true }
    await this.fallback.set(key, value)
  }
  async delete(key: string) {
    if (this.fallbackActive) {
      await this.fallback.delete(key)
      throw new Error("The OS credential vault is unavailable; the process copy was cleared but persistent deletion could not be verified")
    }
    try { await this.primary.delete(key) }
    catch (error) {
      this.fallbackActive = true
      await this.fallback.delete(key)
      throw new Error("The OS credential vault could not confirm deletion; the process copy was cleared", { cause: error })
    }
    await this.fallback.delete(key)
  }
}

export function createDefaultSecretStore(): SecretStore & { readonly storageMode: string } {
  return process.platform === "win32"
    ? new FallbackSecretStore(new WindowsCredentialStore(), new MemorySecretStore())
    : new MemorySecretStore()
}

function targetName(key: string) {
  if (!key.trim() || key.length > 200) throw new Error("Secret key must contain 1–200 characters")
  return `Foreman:${key}`
}

const powershellScript = String.raw`
$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct ForemanCredential {
  public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
  public long LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
  public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}
public static class ForemanCredentialApi {
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredWrite(ref ForemanCredential credential, UInt32 flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr buffer);
  public static void Write(string target, string value) {
    byte[] bytes = Encoding.Unicode.GetBytes(value);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      ForemanCredential item = new ForemanCredential { Type=1, TargetName=target, CredentialBlobSize=(UInt32)bytes.Length,
        CredentialBlob=blob, Persist=2, UserName="Foreman" };
      if (!CredWrite(ref item, 0)) throw new Exception("Credential Manager write failed: " + Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(blob); }
  }
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error(); if (error == 1168) return null;
      throw new Exception("Credential Manager read failed: " + error);
    }
    try {
      ForemanCredential item = (ForemanCredential)Marshal.PtrToStructure(pointer, typeof(ForemanCredential));
      byte[] bytes = new byte[item.CredentialBlobSize]; Marshal.Copy(item.CredentialBlob, bytes, 0, bytes.Length);
      return Encoding.Unicode.GetString(bytes);
    } finally { CredFree(pointer); }
  }
  public static void Delete(string target) {
    if (!CredDelete(target, 1, 0)) { int error = Marshal.GetLastWin32Error(); if (error != 1168) throw new Exception("Credential Manager delete failed: " + error); }
  }
}
'@
Add-Type -TypeDefinition $source
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
switch ($request.op) {
  'get' { $value = [ForemanCredentialApi]::Read($request.target); if ($null -eq $value) { 'NOT_FOUND' } else { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value)) } }
  'set' { [ForemanCredentialApi]::Write($request.target, $request.value); 'OK' }
  'delete' { [ForemanCredentialApi]::Delete($request.target); 'OK' }
  default { throw 'Unsupported credential operation' }
}`

function runPowerShell(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", powershellScript], {
      windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => { child.kill(); reject(new Error("Windows Credential Manager operation timed out")) }, 5_000)
    child.stdout?.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString("utf8")).slice(0, 8_192) })
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(0, 2_048) })
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`Windows Credential Manager unavailable: ${error.message}`)) })
    child.once("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`Windows Credential Manager failed: ${stderr.trim().slice(0, 300) || `exit ${code}`}`))
      else resolve(stdout.trim())
    })
    child.stdin?.end(input)
  })
}
