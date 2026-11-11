import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"
import { AppIcon } from "@/components/icons"
import { PageTransition } from "@/components/layout/page-transition"
import { Wordmark } from "@/components/layout/wordmark"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Surface } from "@/components/ui/surface"
import {
  loginErrorMessage,
  readAuthFailure,
  signupErrorMessage,
} from "@/lib/auth-errors"
import { signIn, signUp, useSession } from "@/lib/auth-client"
import { returnPathFromState } from "@/lib/return-path"
import { isGuest } from "@/lib/session"

const emailField = z.email("Enter a valid email address")
const passwordField = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
const nameField = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(100, "Use at most 100 characters")

const loginSchema = z.object({
  email: emailField,
  password: passwordField,
})

const signupSchema = loginSchema.extend({
  name: nameField,
})

type Mode = "login" | "signup"
type FieldName = "name" | "email" | "password"

function fieldMessage(error: z.ZodError, field: FieldName): string | undefined {
  return error.issues.find((issue) => issue.path[0] === field)?.message
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = useSession()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const schema = mode === "signup" ? signupSchema : loginSchema
  const parsed = schema.safeParse({
    email: email.trim(),
    password,
    ...(mode === "signup" ? { name: name.trim() } : {}),
  })
  const validationError = parsed.success ? null : parsed.error

  function messageFor(field: FieldName): string | undefined {
    if (!validationError) return undefined
    if (!submitAttempted && !touched[field]) return undefined
    return fieldMessage(validationError, field)
  }

  function touch(field: FieldName) {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    setFormError(null)
    const order: FieldName[] =
      mode === "signup" ? ["name", "email", "password"] : ["email", "password"]
    const signupResult =
      mode === "signup"
        ? signupSchema.safeParse({
            name: name.trim(),
            email: email.trim(),
            password,
          })
        : null
    const loginResult =
      mode === "login"
        ? loginSchema.safeParse({
            email: email.trim(),
            password,
          })
        : null
    const failed = signupResult?.success === false ? signupResult.error : loginResult?.success === false ? loginResult.error : null
    if (failed) {
      const first = order.find((field) => fieldMessage(failed, field))
      if (first) document.getElementById(first)?.focus()
      return
    }

    setSubmitting(true)
    const linkedGuest = isGuest(session.data?.user)
    try {
      const response =
        signupResult?.success === true
          ? await signUp.email({
              name: signupResult.data.name,
              email: signupResult.data.email,
              password: signupResult.data.password,
            })
          : await signIn.email({
              email: loginResult?.success === true ? loginResult.data.email : email.trim(),
              password: loginResult?.success === true ? loginResult.data.password : password,
            })
      if (response.error) {
        const failure = readAuthFailure(response.error)
        setFormError(
          mode === "signup"
            ? signupErrorMessage(failure)
            : loginErrorMessage(failure),
        )
        return
      }
      if (linkedGuest) {
        toast.success("Your recent transfers were added to your account")
      }
      await queryClient.invalidateQueries()
      navigate(returnPathFromState(location.state), { replace: true })
    } catch {
      setFormError("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl items-center justify-center px-4 py-24">
      <PageTransition>
        <Surface radius="sheet" padding={20} className="w-full bg-background text-foreground shadow-soft">
          <Wordmark />
          <h1 className="display-lg mt-8">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground sm:text-base">
            {mode === "login"
              ? "Sign in with your email and password."
              : "Use your name, email, and a password to get started."}
          </p>
          <form className="mt-8 grid gap-5" noValidate onSubmit={onSubmit}>
            {mode === "signup" ? (
              <Field label="Name" htmlFor="name" error={messageFor("name")}>
                <Input
                  autoFocus
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => touch("name")}
                />
              </Field>
            ) : null}
            <Field label="Email" htmlFor="email" error={messageFor("email")}>
              <Input
                autoFocus={mode === "login"}
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => touch("email")}
              />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              error={messageFor("password")}
              trailing={
                <button
                  type="button"
                  className="flex size-10 items-center justify-center rounded-inset text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <AppIcon name={showPassword ? "eyeoff" : "eye"} />
                </button>
              }
            >
              <Input
                className="pr-12"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => touch("password")}
              />
            </Field>
            {formError ? (
              <div
                role="alert"
                className="rounded-inset bg-surface px-4 py-3 text-sm text-foreground"
              >
                {formError}
              </div>
            ) : null}
            <Button type="submit" size="lg" className="mt-1 w-full" loading={submitting} disabled={submitting}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Need an account?{" "}
                <Link to="/signup" className="font-medium text-brand">
                  Sign up
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link to="/login" className="font-medium text-brand">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </Surface>
      </PageTransition>
    </div>
  )
}
