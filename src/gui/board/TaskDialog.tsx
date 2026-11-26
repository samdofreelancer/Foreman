import { For, createEffect, createSignal, Show } from "solid-js"
import type { DialogHandle, SetupContext } from "@opencode/plugin/gui"
import type { definition } from "../definition"
import {
  createTask,
  deleteTask,
  updateTask,
  validateTaskInput,
  type Task,
  type TaskColumn,
} from "../../domain/task"

type ProjectOption = {
  directory: string
  name: string
}

export function openTaskDialog(
  ctx: SetupContext<typeof definition>,
  task?: Task,
) {
  ctx.dialogs.open((dialog) => (
    <TaskDialog ctx={ctx} dialog={dialog} task={task} />
  ))
}

export function TaskDialog(props: {
  ctx: SetupContext<typeof definition>
  dialog: DialogHandle
  task?: Task
}) {
  const [title, setTitle] = createSignal(props.task?.title ?? "")
  const [description, setDescription] = createSignal(props.task?.description ?? "")
  const [projectDirectory, setProjectDirectory] = createSignal(props.task?.projectDirectory ?? "")
  const [projectName, setProjectName] = createSignal(props.task?.projectName ?? "")
  const [agent, setAgent] = createSignal(props.task?.agent ?? "build")
  const [providerID, setProviderID] = createSignal(props.task?.model?.providerID ?? "")
  const [modelID, setModelID] = createSignal(props.task?.model?.id ?? "")
  const [column, setColumn] = createSignal<TaskColumn>(props.task?.column ?? "todo")
  const [projects, setProjects] = createSignal<ProjectOption[]>([])

  createEffect(() => {
    const sidecar = props.ctx.servers.list()
      .map((id) => props.ctx.servers.get(id))
      .find((server) => server?.builtin)
    if (!sidecar) return
    void sidecar.client.project.list().then((list) => {
      setProjects(list.map((project) => ({
        directory: project.canonical,
        name: project.name ?? project.canonical,
      })))
    })
  })

  const validation = () => validateTaskInput({
    title: title(),
    projectDirectory: projectDirectory(),
  })

  const save = () => {
    const result = validation()
    if (!result.valid) return
    const now = Date.now()
    const model = providerID().trim() && modelID().trim()
      ? { providerID: providerID().trim(), id: modelID().trim() }
      : undefined
    if (props.task) {
      props.ctx.stores.tasks.update((draft) => {
        const index = draft.findIndex((item) => item.id === props.task?.id)
        if (index < 0) return
        const updated = updateTask(draft[index], {
          title: title().trim(),
          description: description().trim() || undefined,
          projectDirectory: projectDirectory().trim(),
          projectName: projectName().trim() || projectDirectory().trim(),
          agent: agent().trim() || "build",
          model,
          column: column(),
        }, now)
        draft[index] = updated
      })
    } else {
      const task = createTask({
        title: title(),
        description: description(),
        projectDirectory: projectDirectory(),
        projectName: projectName().trim() || projectDirectory().trim(),
        agent: agent(),
        model,
        column: "todo",
      }, now, crypto.randomUUID())
      props.ctx.stores.tasks.update((draft) => {
        draft.unshift(task)
      })
    }
    props.dialog.close()
  }

  const remove = async () => {
    if (!props.task) return
    const confirmed = await props.ctx.dialogs.confirm({
      title: "Delete this task?",
      confirm: "Delete",
      danger: true,
    })
    if (!confirmed) return
    props.ctx.stores.tasks.update((draft) => {
      const next = deleteTask(draft, props.task!.id)
      draft.splice(0, draft.length, ...next)
    })
    props.dialog.close()
  }

  return (
    <form
      class="foreman-dialog"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <h2>{props.task ? "Edit task" : "New task"}</h2>
      <label>
        <span>Title</span>
        <input value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
        <Show when={validation().titleError}>
          {(message) => <small>{message()}</small>}
        </Show>
      </label>
      <label>
        <span>Description</span>
        <textarea
          rows={5}
          value={description()}
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Project</span>
        <select
          value={projectDirectory()}
          onInput={(event) => {
            const directory = event.currentTarget.value
            setProjectDirectory(directory)
            const selected = projects().find((project) => project.directory === directory)
            setProjectName(selected?.name ?? "")
          }}
        >
          <option value="">Choose project</option>
          <For each={projects()}>
            {(project) => (
              <option value={project.directory}>{project.name} - {project.directory}</option>
            )}
          </For>
        </select>
        <input
          value={projectDirectory()}
          placeholder="Or enter an absolute project directory"
          onInput={(event) => setProjectDirectory(event.currentTarget.value)}
        />
        <Show when={validation().projectError}>
          {(message) => <small>{message()}</small>}
        </Show>
      </label>
      <label>
        <span>Agent</span>
        <input value={agent()} onInput={(event) => setAgent(event.currentTarget.value)} />
      </label>
      <div class="foreman-model-fields">
        <label>
          <span>Provider</span>
          <input value={providerID()} onInput={(event) => setProviderID(event.currentTarget.value)} />
        </label>
        <label>
          <span>Model</span>
          <input value={modelID()} onInput={(event) => setModelID(event.currentTarget.value)} />
        </label>
      </div>
      <Show when={props.task}>
        <label>
          <span>Column</span>
          <select
            value={column()}
            onInput={(event) => setColumn(event.currentTarget.value as TaskColumn)}
          >
            <option value="todo">Todo</option>
            <option value="ready">Ready</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
          </select>
        </label>
      </Show>
      <div class="foreman-dialog-actions">
        <Show when={props.task}>
          <button type="button" onClick={() => void remove()}>Delete</button>
        </Show>
        <button type="button" onClick={() => props.dialog.close()}>Cancel</button>
        <button class="foreman-primary" type="submit" disabled={!validation().valid}>Save</button>
      </div>
    </form>
  )
}
