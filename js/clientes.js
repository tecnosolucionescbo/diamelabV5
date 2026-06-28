/**
 * Módulo de Clientes - Solo Administrador
 */
document.addEventListener('DOMContentLoaded', async () => {
    const isAuth = await protectRoute();
    if (!isAuth) return;

    initNavigation();
    updateUserAvatar();

    if (!isAdmin()) {
        showAlert('Acceso denegado. Se requieren permisos de administrador.', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }

    await actualizarDisplayTasa('#tasa-bcv');
    await cargarClientes();

    // Eventos
    document.getElementById('btn-nuevo-cliente').addEventListener('click', () => abrirModalCliente());
    document.getElementById('btn-cerrar-modal-cliente').addEventListener('click', cerrarModalCliente);
    document.getElementById('btn-cancelar-cliente').addEventListener('click', cerrarModalCliente);
    document.getElementById('btn-guardar-cliente').addEventListener('click', guardarCliente);
    document.getElementById('btn-filtrar-clientes').addEventListener('click', cargarClientes);
    document.getElementById('btn-limpiar-clientes').addEventListener('click', () => {
        document.getElementById('filtro-cliente').value = '';
        cargarClientes();
    });
    document.getElementById('filtro-cliente').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cargarClientes();
    });
    document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
        invalidateTasaCache();
        await actualizarDisplayTasa('#tasa-bcv');
    });

    document.getElementById('modal-cliente').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalCliente();
    });
});

let clientesCache = [];

async function cargarClientes() {
    const tbody = document.getElementById('tbody-clientes');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner"></div> Cargando...</td></tr>`;

    try {
        const filtro = document.getElementById('filtro-cliente').value.trim();
        const data = await getClientes();
        clientesCache = data;

        let filtrados = data;
        if (filtro) {
            filtrados = data.filter(c => 
                c.razon_social.toLowerCase().includes(filtro.toLowerCase()) ||
                (c.rif && c.rif.toLowerCase().includes(filtro.toLowerCase()))
            );
        }

        if (filtrados.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400);">No hay clientes registrados.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtrados.map(c => `
            <tr>
                <td><strong>${c.razon_social}</strong></td>
                <td>${c.rif}</td>
                <td>${c.direccion || '-'}</td>
                <td>${c.telefono || '-'}</td>
                <td>${c.email || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-ghost" onclick="editarCliente('${c.id}')" title="Editar">✏️</button>
                    <button class="btn btn-sm btn-ghost" onclick="eliminarCliente('${c.id}')" title="Eliminar" style="color:var(--danger);">🗑️</button>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error cargando clientes:', error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger);">Error al cargar clientes.</td></tr>`;
        showAlert('Error al cargar clientes', 'error');
    }
}

function abrirModalCliente(cliente = null) {
    const modal = document.getElementById('modal-cliente');
    const titulo = document.getElementById('modal-cliente-titulo');
    const form = document.getElementById('form-cliente');

    form.reset();
    document.getElementById('c-id').value = '';

    if (cliente) {
        titulo.textContent = 'Editar Cliente';
        document.getElementById('c-razon').value = cliente.razon_social;
        document.getElementById('c-rif').value = cliente.rif;
        document.getElementById('c-direccion').value = cliente.direccion || '';
        document.getElementById('c-telefono').value = cliente.telefono || '';
        document.getElementById('c-email').value = cliente.email || '';
        document.getElementById('c-id').value = cliente.id;
    } else {
        titulo.textContent = 'Nuevo Cliente';
    }

    modal.style.display = 'flex';
}

window.editarCliente = function(id) {
    const cliente = clientesCache.find(c => c.id === id);
    if (!cliente) {
        showAlert('Cliente no encontrado', 'error');
        return;
    }
    abrirModalCliente(cliente);
};

function cerrarModalCliente() {
    document.getElementById('modal-cliente').style.display = 'none';
}

async function guardarCliente() {
    const id = document.getElementById('c-id').value;
    const razon = document.getElementById('c-razon').value.trim();
    const rif = document.getElementById('c-rif').value.trim();
    const direccion = document.getElementById('c-direccion').value.trim() || null;
    const telefono = document.getElementById('c-telefono').value.trim() || null;
    const email = document.getElementById('c-email').value.trim() || null;

    if (!razon || !rif) {
        showAlert('Razón Social y RIF son obligatorios.', 'error');
        return;
    }

    const rifError = validateRIF(rif);
    if (rifError) {
        showAlert(rifError, 'error');
        return;
    }

    try {
        showLoading('#btn-guardar-cliente', 'Guardando...');

        if (id) {
            await updateCliente(id, { razon_social: razon, rif, direccion, telefono, email });
            showAlert('Cliente actualizado correctamente', 'success');
        } else {
            await createCliente({ razon_social: razon, rif, direccion, telefono, email });
            showAlert('Cliente creado correctamente', 'success');
        }

        cerrarModalCliente();
        await cargarClientes();
    } catch (error) {
        console.error('Error guardando cliente:', error);
        if (error.message && error.message.includes('duplicate')) {
            showAlert('Ya existe un cliente con ese RIF', 'error');
        } else {
            showAlert('Error al guardar: ' + error.message, 'error');
        }
    } finally {
        hideLoading('#btn-guardar-cliente');
    }
}

window.eliminarCliente = async function(id) {
    const confirmado = await confirmAction('¿Estás seguro de eliminar este cliente? Si tiene notas de entrega asociadas no podrá eliminarse.');
    if (!confirmado) return;

    try {
        await deleteCliente(id);
        showAlert('Cliente eliminado correctamente', 'success');
        await cargarClientes();
    } catch (error) {
        console.error('Error eliminando cliente:', error);
        showAlert('Error al eliminar: ' + error.message, 'error');
    }
};
