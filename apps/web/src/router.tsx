import { Navigate, createBrowserRouter } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import { HomeEntry } from "@/components/layout/home-entry"
import { PublicLayout } from "@/components/layout/public-layout"
import { GuestOnly, RequireAuth, RootLayout } from "@/components/route-guards"
import {
  FilesPage,
  InboxPage,
  LoginPage,
  NotificationsPage,
  NotFoundPage,
  PublicSharePage,
  SettingsPage,
  SharedLinksPage,
  SignupPage,
} from "@/pages/lazy-pages"

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomeEntry /> },
      {
        element: <PublicLayout />,
        children: [
          {
            element: <GuestOnly />,
            children: [
              { path: "/login", element: <LoginPage /> },
              { path: "/signup", element: <SignupPage /> },
            ],
          },
          { path: "/s/:token", element: <PublicSharePage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "/files", element: <FilesPage /> },
              { path: "/links", element: <SharedLinksPage /> },
              { path: "/inbox", element: <InboxPage /> },
              { path: "/notifications", element: <NotificationsPage /> },
              { path: "/settings", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "/shared", element: <Navigate to="/links" replace /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])
