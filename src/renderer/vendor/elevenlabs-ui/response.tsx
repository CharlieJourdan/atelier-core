// Vendored from elevenlabs/ui (MIT) – see VENDOR.md and ./LICENSE. Modified for Atelier: `streamdown` (shiki, mermaid, KaTeX, remote assets: heavy, and against the strict CSP) is replaced by Atelier's own small markdown renderer (components/conversations/markdown.tsx), which tolerates half-streamed text.
import { memo } from "react"

import { cn } from "@/lib/utils"
import { Markdown } from "@/components/conversations/markdown"

type ResponseProps = { children: string; className?: string }

export const Response = memo(
  ({ className, children }: ResponseProps) => (
    <div
      data-slot="response"
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
    >
      <Markdown text={children} />
    </div>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.className === nextProps.className
)

Response.displayName = "Response"
