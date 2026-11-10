export type AuthFailure = {
  status: number
  code?: string
}

export function readAuthFailure(error: object): AuthFailure {
  const status = "status" in error && typeof error.status === "number" ? error.status : 0
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined
  return { status, code }
}

export function loginErrorMessage(failure: AuthFailure): string {
  if (failure.status === 429) {
    return "Too many attempts. Please wait a moment and try again."
  }
  return "Incorrect email or password"
}

export function signupErrorMessage(failure: AuthFailure): string {
  if (failure.status === 429) {
    return "Too many attempts. Please wait a moment and try again."
  }
  if (
    failure.code === "USER_ALREADY_EXISTS" ||
    failure.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ||
    failure.status === 422
  ) {
    return "An account with this email already exists."
  }
  return "Something went wrong. Please try again."
}
