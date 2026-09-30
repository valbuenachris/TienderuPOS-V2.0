import { Notice, PageHeader, Panel } from '../components/ui';

export default function PendingPage({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <PageHeader eyebrow="PRÓXIMA FASE" title={title} />
      <Panel className="stack">
        <Notice>Módulo en preparación.</Notice>
        <p className="muted">{detail}</p>
        <p className="muted">Antes de implementarlo se valida el esquema vivo con `information_schema` y se define, junto al POS legacy, la semántica de escritura. No se aplicarán cambios de esquema (DDL).</p>
      </Panel>
    </>
  );
}
