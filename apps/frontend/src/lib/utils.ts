import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system adds font sizes (styles/globals.css @theme). Without
// registering them, tailwind-merge treats `text-ui` as a colour and drops it.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "ui", "title", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
