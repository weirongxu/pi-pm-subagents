/** Built-in tools that mutate the filesystem — disabled in read-only modes. */
export const WRITE_TOOLS = new Set(['edit', 'write'])

export const MANAGER_TOOLS = {
  delegate: 'worker_delegate',
  kill: 'worker_kill',
  list: 'worker_list',
}

/** Key under which the modes' state is persisted in the session. */
export const STATE_KEY = 'modes'

export const ASK_EVENT_KEY_UI_START = 'pi-utils:ask_user_question:ui_start'
export const ASK_EVENT_KEY_UI_END = 'pi-utils:ask_user_question:ui_end'
