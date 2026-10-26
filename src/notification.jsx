import React, { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
export function Notification({ message, onDismiss }) {
  const [visible, setVisible] = useState(message),
    [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (message) {
      setVisible(message);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => setVisible(""), 260);
    return () => clearTimeout(timer);
  }, [message]);
  if (!visible) return null;
  return (
    <aside
      className="studio-notification"
      data-leaving={leaving}
      role="status"
      aria-live="polite"
    >
      <Info size={17} />
      <span>{visible}</span>
      <button
        className="icon"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>
    </aside>
  );
}
