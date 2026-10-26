import React from "react";
export class RecoveryBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="panel-recovery">
        <p>This panel could not open. Your project is still available.</p>
        <button onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
        <button onClick={this.props.onClose}>Close panel</button>
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
