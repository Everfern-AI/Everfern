"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export function DialogSurface({ label, onClose, ...props }: HTMLMotionProps<"div"> & { label: string; onClose?: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(true, onClose);
  return <motion.div {...props} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} />;
}
