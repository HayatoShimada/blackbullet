import { useState } from "preact/hooks";
import { Input, type InputProps } from "./input.tsx";
import { Button } from "./button.tsx";

export type PasswordInputProps = Omit<InputProps, "type"> & {
  toggleId?: string;
};
export function PasswordInput({ toggleId, ...props }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div class="password-field sb-password-field">
      <Input {...props} type={revealed ? "text" : "password"} />
      <Button
        id={toggleId}
        disabled={props.disabled}
        aria-label={revealed ? "Hide password" : "Show password"}
        aria-pressed={revealed}
        aria-controls={props.id}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? "Hide" : "Show"}
      </Button>
    </div>
  );
}
