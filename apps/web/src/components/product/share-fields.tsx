import { SHARE_PASSWORD_MIN } from "@transfile/shared"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EXPIRY_CHOICES } from "@/lib/expiry"
import type { ShareDraft } from "@/lib/share-draft"

const limits = [
  { value: "unlimited", label: "Unlimited" },
  { value: "1", label: "1" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
  { value: "50", label: "50" },
] as const

export function ShareFields({
  draft,
  onChange,
  member,
  choices = [...EXPIRY_CHOICES],
  idPrefix,
  showMessage = true,
}: {
  draft: ShareDraft
  onChange: (draft: ShareDraft) => void
  member: boolean
  choices?: number[]
  idPrefix: string
  showMessage?: boolean
}) {
  return (
    <div className="divide-y divide-border">
      <div className="grid gap-2 py-3">
        <Field label="Expiry" htmlFor={`${idPrefix}-expiry`}>
          <Select
            value={String(draft.expiresInHours)}
            onValueChange={(value) => onChange({ ...draft, expiresInHours: Number(value) })}
          >
            <SelectTrigger id={`${idPrefix}-expiry`} aria-label="Expiry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((hours) => (
                <SelectItem key={hours} value={String(hours)}>
                  {hours}h
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">Links last at most 72 hours.</p>
      </div>
      <div className="grid gap-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Password</span>
          <Switch
            checked={draft.passwordOn}
            label="Password"
            onCheckedChange={(passwordOn) => onChange({ ...draft, passwordOn })}
          />
        </div>
        {draft.passwordOn ? (
          <Field label="Password" htmlFor={`${idPrefix}-password`}>
            <Input
              id={`${idPrefix}-password`}
              type="password"
              autoComplete="new-password"
              minLength={SHARE_PASSWORD_MIN}
              value={draft.password}
              onChange={(event) => onChange({ ...draft, password: event.target.value })}
            />
          </Field>
        ) : null}
      </div>
      <div className="grid gap-2 py-3">
        <Field label="Download limit" htmlFor={`${idPrefix}-limit`}>
          <Select value={draft.limit} onValueChange={(limit) => onChange({ ...draft, limit })}>
            <SelectTrigger id={`${idPrefix}-limit`} aria-label="Download limit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {limits.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-2 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Allow comments</span>
          <Switch
            checked={member && draft.allowComments}
            disabled={!member}
            label="Allow comments"
            onCheckedChange={(allowComments) => onChange({ ...draft, allowComments })}
          />
        </div>
        {member ? null : (
          <p className="text-xs text-muted-foreground">Sign up to receive comments</p>
        )}
      </div>
      {showMessage ? (
        <div className="py-3">
          <Field label="Message" htmlFor={`${idPrefix}-message`}>
            <Textarea
              id={`${idPrefix}-message`}
              value={draft.message}
              maxLength={500}
              placeholder="Optional"
              onChange={(event) => onChange({ ...draft, message: event.target.value })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  )
}
