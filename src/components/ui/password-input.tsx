import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * Password field with a show/hide toggle.
 *
 * This reveals ONLY the characters the user just typed, in their own browser,
 * at the moment they ask for it. It never reads the stored credential: account
 * passwords are scrypt-hashed (see src/lib/auth.ts) and cannot be recovered.
 *
 * The point is typo recovery — most password-field mistakes are a transposed
 * character or a stuck Shift/caps-lock, and on a "confirm password" form a typo
 * in the first field is invisible without a way to reveal it.
 */
function PasswordInput({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"input"> & { containerClassName?: string }) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Stops the click from blurring the field, so the user keeps their
        // caret position and doesn't lose focus while checking the value.
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export { PasswordInput }
