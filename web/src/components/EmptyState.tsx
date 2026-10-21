export function EmptyState(props: {
  title: string;
  body?: string;
  tone?: "error";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`empty ${props.tone === "error" ? "empty-error" : ""}`} role={props.tone === "error" ? "alert" : undefined}>
      <h2>{props.title}</h2>
      {props.body && <p>{props.body}</p>}
      {props.action && (
        <button className="btn" onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}
