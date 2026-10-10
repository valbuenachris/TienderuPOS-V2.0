import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useCategoriesQuery } from '../pos-queries';
import { createCategory, deleteCategory, updateCategory } from '../api';
import type { CategoryRecord } from '../api';

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const categoriesQuery = useCategoriesQuery(token, tenantId);

  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRecord | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const saveMutation = useApiMutation((input: { id: string | null; name: string; description: string }) =>
    input.id === null
      ? createCategory({ name: input.name, description: input.description || null })
      : updateCategory(input.id, { name: input.name, description: input.description || null })
  );
  const deleteMutation = useApiMutation((id: string) => deleteCategory(id));

  const categories = categoriesQuery.data ?? [];

  function openCreate() {
    setNotice('');
    setEditing(null);
    setName('');
    setDescription('');
    setModalOpen(true);
  }

  function openEdit(category: CategoryRecord) {
    setNotice('');
    setEditing(category);
    setName(category.name);
    setDescription(category.description ?? '');
    setModalOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setNotice('El nombre de la categoría es obligatorio.');
      return;
    }
    saveMutation.mutate(
      { id: editing?.id ?? null, name: name.trim(), description: description.trim() },
      {
        onSuccess: async (category) => {
          setNotice(`Categoría “${category.name}” ${editing ? 'actualizada' : 'creada'}.`);
          setModalOpen(false);
          await queryClient.invalidateQueries({ queryKey: ['categories'] });
        },
        onError: (error: Error) => setNotice(error.message)
      }
    );
  }

  function confirmRemove(category: CategoryRecord) {
    if (!window.confirm(`¿Eliminar la categoría “${category.name}”?`)) return;
    setNotice('');
    deleteMutation.mutate(category.id, {
      onSuccess: async () => {
        setNotice(`Categoría “${category.name}” eliminada.`);
        await queryClient.invalidateQueries({ queryKey: ['categories'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="CATÁLOGO"
        title="Categorías"
        actions={<button className="primary" type="button" onClick={openCreate}>+ Nueva categoría</button>}
      />
      {notice ? <Notice tone={/error|no se|obligatori|inválid|invalid|ya existe/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {categoriesQuery.isError ? <Notice tone="error">No fue posible cargar las categorías.</Notice> : null}

      <Panel className="stack full-width">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Nombre</th><th>Descripción</th><th>Productos</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td><strong>{category.name}</strong></td>
                  <td>{category.description || '—'}</td>
                  <td>{category.product_count}</td>
                  <td className="row-actions">
                    <button
                      className="icon-button"
                      type="button"
                      title="Editar categoría"
                      aria-label="Editar categoría"
                      onClick={() => openEdit(category)}
                    >
                      ✏️
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      title="Eliminar categoría"
                      aria-label="Eliminar categoría"
                      disabled={deleteMutation.isPending}
                      onClick={() => confirmRemove(category)}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && !categoriesQuery.isPending ? (
                <tr><td colSpan={4} className="empty">No hay categorías registradas.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        open={modalOpen}
        eyebrow={editing ? 'EDITANDO' : 'NUEVA'}
        title={editing ? `Editar · ${editing.name}` : 'Nueva categoría'}
        onClose={() => setModalOpen(false)}
      >
        <form className="form-grid" onSubmit={submit}>
          <label>Nombre
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} />
          </label>
          <label>Descripción (opcional)
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 255))}
              rows={3}
              maxLength={255}
              placeholder="Ej: Bebidas frías, snacks, aseo…"
            />
          </label>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>
              Cancelar
            </button>
            <button className="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
