import { lazy } from "react"

export const LoginPage = lazy(() => import("@/pages/login-page"))
export const SignupPage = lazy(() => import("@/pages/signup-page"))
export const SendPage = lazy(() => import("@/pages/send-page"))
export const FilesPage = lazy(() => import("@/pages/files-page"))
export const SharedLinksPage = lazy(() => import("@/pages/shared-links-page"))
export const InboxPage = lazy(() => import("@/pages/inbox-page"))
export const NotificationsPage = lazy(() => import("@/pages/notifications-page"))
export const SettingsPage = lazy(() => import("@/pages/settings-page"))
export const PublicSharePage = lazy(() => import("@/pages/public-share-page"))
export const NotFoundPage = lazy(() => import("@/pages/not-found-page"))
