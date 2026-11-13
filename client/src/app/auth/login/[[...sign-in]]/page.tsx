import { SignIn } from "@clerk/nextjs";

// Signing in (email code or password, Google, and resetting a forgotten password) is Clerk's form. Which methods are
// switched on is set in the Clerk dashboard. After signing in the person stays on /auth/login, where the auth layout
// sends them on to /onboarding to choose the student or teacher side.
export default function LoginPage() {
  return <SignIn path="/auth/login" routing="path" signUpUrl="/auth/register" forceRedirectUrl="/auth/login" />;
}
