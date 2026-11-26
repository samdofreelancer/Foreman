import { definition } from "./gui/definition"

export const Plugin = {
  define(options: unknown) {
    return options
  },
}

export default Plugin.define({ ...definition })
