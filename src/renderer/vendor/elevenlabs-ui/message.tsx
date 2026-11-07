// Vendored from elevenlabs/ui (MIT) – see VENDOR.md and ./LICENSE. Modified for Atelier: shadcn tokens mapped to Atelier's (surface-2, brand, fg); the image Avatar is replaced by a `MessageAvatar` slot that takes any node (an AgentDot).
import type { HTMLAttributes, ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant"
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full items-end justify-end gap-2 py-1.5",
      from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
      className
    )}
    {...props}
  />
)

const messageContentVariants = cva(
  "flex flex-col gap-2 overflow-hidden rounded-2xl text-[14px] leading-relaxed",
  {
    variants: {
      variant: {
        contained: [
          "max-w-[80%] px-4 py-2.5",
          "group-[.is-user]:bg-brand group-[.is-user]:text-ink-fg",
          "group-[.is-assistant]:bg-surface-2 group-[.is-assistant]:text-fg",
        ],
        flat: [
          "group-[.is-user]:max-w-[80%] group-[.is-user]:bg-surface-2 group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-fg",
          "group-[.is-assistant]:text-fg",
        ],
      },
    },
    defaultVariants: {
      variant: "contained",
    },
  }
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof messageContentVariants>

export const MessageContent = ({
  children,
  className,
  variant,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(messageContentVariants({ variant, className }))}
    {...props}
  >
    {children}
  </div>
)

export const MessageAvatar = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => <div className={cn("flex size-8 shrink-0 items-center justify-center self-start", className)}>{children}</div>
