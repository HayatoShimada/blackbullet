import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Button, Input } from "@silverbulletmd/silverbullet/ui";

export function Prompt({
  message,
  defaultValue,
  callback,
}: {
  message: string;
  defaultValue?: string;
  darkMode: boolean | undefined;
  callback: (value?: string) => void;
}) {
  const [text, setText] = useState(defaultValue || "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end); // caret at end of default value
    }
  }, []);
  const returnEl = (
    <AlwaysShownModal
      onCancel={() => {
        callback();
      }}
    >
      <div className="sb-prompt">
        <label>{message}</label>
        <Input
          inputRef={inputRef}
          class="sb-prompt-input"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onConfirm={(value) => callback(value)}
          onExit={() => callback()}
        />
        <div className="sb-prompt-buttons">
          <Button
            shortcut="esc"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            shortcut="⏎"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(text);
            }}
          >
            Ok
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}

// Split a confirmation message into its question and the consequence that
// follows ("Move X to the trash? You can restore it from Trash."), so the
// question can be stressed and the consequence stay quieter.
export function splitQuestion(message: string): {
  question: string;
  rest: string;
} {
  // ASCII "?" must be followed by whitespace (not a URL query); CJK marks
  // need no space.
  const m = message.match(/^([\s\S]*?(?:\?(?=\s)|[？。]))\s*([\s\S]+)$/);
  if (!m?.[2].trim()) {
    return { question: message, rest: "" };
  }
  return { question: m[1], rest: m[2] };
}

export function Confirm({
  message,
  destructive,
  okLabel,
  focusCancel,
  callback,
}: {
  message: string;
  destructive?: boolean;
  okLabel?: string;
  focusCancel?: boolean;
  callback: (value: boolean) => void;
}) {
  const { question, rest } = splitQuestion(message);
  const okButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // A destructive question starts on Cancel unless the caller says otherwise.
  const cancelFirst = focusCancel ?? !!destructive;
  setTimeout(() => {
    (cancelFirst ? cancelButtonRef : okButtonRef).current?.focus();
  });
  const returnEl = (
    <AlwaysShownModal
      onCancel={() => {
        callback(false);
      }}
    >
      <div className="sb-prompt">
        <label>
          <span className="sb-prompt-question">{question}</span>
          {rest ? ` ${rest}` : ""}
        </label>
        <div className="sb-prompt-buttons">
          <Button
            buttonRef={cancelButtonRef}
            autofocus={cancelFirst}
            shortcut="esc"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(false);
            }}
          >
            Cancel
          </Button>
          <Button
            buttonRef={okButtonRef}
            autofocus={!cancelFirst}
            variant={destructive ? "danger" : "primary"}
            shortcut={cancelFirst ? undefined : "⏎"}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              callback(true);
            }}
          >
            {okLabel || "Ok"}
          </Button>
        </div>
      </div>
    </AlwaysShownModal>
  );

  return returnEl;
}

export function AlwaysShownModal({
  children,
  onCancel,
}: {
  children: ComponentChildren;
  onCancel?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      className="sb-modal-box"
      onCancel={(e: Event) => {
        e.preventDefault();
        onCancel?.();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
