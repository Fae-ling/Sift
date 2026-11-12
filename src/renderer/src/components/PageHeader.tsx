/** The top of every page: what it is, one line on what it is for, and its main actions on the right. */
export function PageHeader({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }): React.JSX.Element {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}
