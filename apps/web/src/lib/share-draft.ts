export type ShareDraft = {
  expiresInHours: number
  passwordOn: boolean
  password: string
  limit: string
  allowComments: boolean
  message: string
}

export const emptyShareDraft: ShareDraft = {
  expiresInHours: 72,
  passwordOn: false,
  password: "",
  limit: "unlimited",
  allowComments: true,
  message: "",
}

export function shareBody(draft: ShareDraft, member: boolean) {
  return {
    expiresInHours: draft.expiresInHours,
    allowComments: member && draft.allowComments,
    ...(draft.passwordOn ? { password: draft.password } : {}),
    ...(draft.limit !== "unlimited" ? { maxDownloads: Number(draft.limit) } : {}),
    ...(draft.message.trim() ? { message: draft.message.trim() } : {}),
  }
}
