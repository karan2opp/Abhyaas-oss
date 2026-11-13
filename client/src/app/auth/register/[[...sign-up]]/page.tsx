import { SignUp } from "@clerk/nextjs";

// Creating an account is Clerk's form, including the email check. After signing up the person is sent on to
// /onboarding to choose whether they start as a student or a teacher.
export default function RegisterPage() {
  return <SignUp path="/auth/register" routing="path" signInUrl="/auth/login" forceRedirectUrl="/auth/login" />;
}
