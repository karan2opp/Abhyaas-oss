import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

// Makes Clerk's sign-in and sign-up forms look like the rest of the site: dark, orange accent, underline fields with no
// boxes. The form sits inside the card the auth layout already draws, so Clerk's own card is made see-through.
//
// Every class ends in "!" (Tailwind's important marker). Clerk's own styles are loaded after Tailwind's, and a plain
// class loses to them; an important one always wins. The "!" has to be written out here, not added by code, or Tailwind
// won't see the class and won't generate it.
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#ea580c",
    colorBackground: "#0f0f11",
    colorForeground: "#ffffff",
    colorMutedForeground: "#9ca3af",
    colorInput: "transparent",
    colorInputForeground: "#ffffff",
    colorDanger: "#f87171",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full!",
    cardBox: "w-full! max-w-none! rounded-none! border-0! bg-transparent! shadow-none!",
    card: "w-full! gap-5! rounded-none! border-0! bg-transparent! p-0! shadow-none!",
    // The auth layout already shows the logo and a heading, so Clerk's own title is hidden.
    header: "hidden!",

    socialButtonsBlockButton: "rounded-xl! border! border-white/10! bg-white/5! text-white! shadow-none! hover:bg-white/10!",
    socialButtonsBlockButtonText: "text-white!",
    // The small "Last used" label Clerk pins half outside the corner of the button a returning person last signed in with.
    // It gets clipped against the card, so it is hidden.
    lastAuthenticationStrategyBadge: "hidden!",
    dividerLine: "bg-white/10!",
    dividerText: "text-gray-500!",

    formFieldLabel: "text-xs! font-medium! text-gray-300!",
    formFieldInput:
      "rounded-none! border-0! border-b! border-white/20! bg-transparent! px-0! text-white! shadow-none! outline-none! ring-0! focus:border-orange-500! focus:ring-0! focus:shadow-none!",
    formFieldInputShowPasswordButton: "text-gray-400! hover:text-white!",
    otpCodeFieldInput: "rounded-none! border-0! border-b! border-white/20! bg-transparent! text-white! shadow-none!",
    formFieldAction: "text-orange-400! hover:text-orange-300!",
    formButtonPrimary: "rounded-xl! bg-orange-600! text-white! shadow-none! hover:bg-orange-700!",
    formResendCodeLink: "text-orange-400! hover:text-orange-300!",
    identityPreviewText: "text-white!",
    identityPreviewEditButton: "text-orange-400!",
    alert: "rounded-xl! border! border-red-500/30! bg-red-500/10!",

    footer: "border-0! bg-transparent! shadow-none! [background:none]!",
    footerAction: "bg-transparent!",
    footerActionText: "text-gray-400!",
    footerActionLink: "text-orange-400! hover:text-orange-300!",
  },
};
