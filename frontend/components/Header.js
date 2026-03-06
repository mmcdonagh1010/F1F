export default function Header({ title, subtitle }) {
  return (
    <header className="mb-5">
      <p className="font-display text-2xl tracking-wide text-accent-cyan">F1 FRIENDS LEAGUE</p>
      <h1 className="text-3xl font-extrabold leading-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
    </header>
  );
}
