import React from "react";
import { isInterfaceLoadError } from "../shared/panel-recovery.mjs";
export class RecoveryBoundary extends React.Component {
  state = { failed: false, error: null };
  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }
  componentDidCatch(error, info) {
    console.error("Panel failed to open", error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="panel-recovery">
        <p>
          {isInterfaceLoadError(this.state.error)
            ? "Part of the interface could not load. Reload the app to get the current version."
            : "This panel could not open. Your project is still available."}
        </p>
        {isInterfaceLoadError(this.state.error) ? (
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        ) : (
          <button
            type="button"
            onClick={() => this.setState({ failed: false, error: null })}
          >
            Try again
          </button>
        )}
        <button type="button" onClick={this.props.onClose}>
          Close panel
        </button>
        <details>
          <summary>Error details</summary>
          <pre>
            {String(this.state.error?.message || "Unknown panel error")}
          </pre>
        </details>
      </div>
    );
  }
}
// Keep transient number strings ("", "4.") out of the undo history.
export function CommittedNumber({ value, onCommit, ...props }) {
  const [text, setText] = React.useState(String(value ?? 0));
  React.useEffect(() => setText(String(value ?? 0)), [value]);
  function commit() {
    const n = Number(text);
    if (n === Number(value)) return;
    if (
      text.trim() &&
      Number.isFinite(n) &&
      (props.min == null || n >= Number(props.min)) &&
      (props.max == null || n <= Number(props.max))
    )
      onCommit(n);
    else setText(String(value ?? 0));
  }
  return (
    <input
      {...props}
      type="number"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setText(String(value ?? 0));
        }
      }}
    />
  );
}
