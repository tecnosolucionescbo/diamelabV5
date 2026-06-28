/**
 * Módulo de Usuarios - Solo Administrador
 */
document.addEventListener('DOMContentLoaded', async () => {
  const isAuth = await protectRoute();
  if (!isAuth) return;

  initNavigation();
  updateUserAvatar();

  // Verificar que sea admin
  if (!isAdmin()) {
    showAlert('Acceso denegado. Se requieren permisos de administrador.', 'error');
    setTimeout(() => window.location.href = 'dashboard.html', 1500);
    return;
  }

  // Cargar tasa BCV
  await actualizarDisplayTasa('#tasa-bcv');

  // Cargar usuarios
  await cargarUsuarios();

  // Eventos
  document.getElementById('btn-nuevo-usuario').addEventListener('click', () => abrirModalUsuario());
  document.getElementById('btn-cerrar-modal-usuario').addEventListener('click', cerrarModalUsuario);
  document.getElementById('btn-cancelar-usuario').addEventListener('click', cerrarModalUsuario);
  document.getElementById('btn-guardar-usuario').addEventListener('click', guardarUsuario);
  document.getElementById('btn-filtrar-usuarios').addEventListener('click', cargarUsuarios);
  document.getElementById('btn-limpiar-usuarios').addEventListener('click', () => {
    document.getElementById('filtro-usuario').value = '';
    cargarUsuarios();
  });
  document.getElementById('filtro-usuario').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') cargarUsuarios();
  });
  document.getElementById('btn-refresh-tasa').addEventListener('click', async () => {
    invalidateTasaCache();
    await actualizarDisplayTasa('#tasa-bcv');
  });

  // Cerrar modal al hacer click fuera
  document.getElementById('modal-usuario').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarModalUsuario();
  });
});

let usuariosCache = [];

async function cargarUsuarios() {
  const tbody = document.getElementById('tbody-usuarios');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner"></div> Cargando...</td></tr>`;

  try {
    const filtro = document.getElementById('filtro-usuario').value.trim();
    const { data, count } = await getProfiles({ limit: 200, filtro });
    usuariosCache = data;

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--gray-400);">No hay usuarios registrados.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(u => {
      const roleLabels = {
        'admin': 'Administrador',
        'vendedor_bolivar': 'Vendedor - Ciudad Bolívar',
        'vendedor_guayana': 'Vendedor - Ciudad Guayana',
        'vendedor_maturin': 'Vendedor - Maturín'
      };
      const activo = u.activo !== false;
      return `
        <tr>
          <td><strong>${u.full_name}</strong></td>
          <td>${u.email || 'N/A'}</td>
          <td>${roleLabels[u.role] || u.role}</td>
          <td>${u.sede || 'N/A'}</td>
          <td><span class="badge ${activo ? 'badge-pagada' : 'badge-anulada'}">${activo ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <button class="btn btn-sm btn-ghost" onclick="editarUsuario('${u.id}')" title="Editar">✏️</button>
            <button class="btn btn-sm btn-ghost" onclick="eliminarUsuario('${u.id}')" title="Desactivar" style="color:var(--danger);">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Error cargando usuarios:', error);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger);">Error al cargar usuarios.</td></tr>`;
    showAlert('Error al cargar usuarios', 'error');
  }
}

function abrirModalUsuario(usuario = null) {
  const modal = document.getElementById('modal-usuario');
  const titulo = document.getElementById('modal-usuario-titulo');
  const form = document.getElementById('form-usuario');

  form.reset();
  document.getElementById('u-id').value = '';

  if (usuario) {
    titulo.textContent = 'Editar Usuario';
    document.getElementById('u-fullname').value = usuario.full_name;
    document.getElementById('u-email').value = usuario.email || '';
    document.getElementById('u-role').value = usuario.role;
    document.getElementById('u-sede').value = usuario.sede || '';
    document.getElementById('u-id').value = usuario.id;
    document.getElementById('u-password-group').style.display = 'none';
    document.getElementById('u-estado-group').style.display = '';
    document.getElementById('u-estado').value = usuario.activo !== false ? 'true' : 'false';
    document.getElementById('u-email').disabled = true;
  } else {
    titulo.textContent = 'Nuevo Usuario';
    document.getElementById('u-password-group').style.display = '';
    document.getElementById('u-estado-group').style.display = 'none';
    document.getElementById('u-email').disabled = false;
  }

  modal.style.display = 'flex';
}

window.editarUsuario = async function(id) {
  try {
    const usuario = usuariosCache.find(u => u.id === id);
    if (!usuario) {
      showAlert('Usuario no encontrado', 'error');
      return;
    }
    abrirModalUsuario(usuario);
  } catch (error) {
    console.error(error);
    showAlert('Error al cargar usuario', 'error');
  }
};

function cerrarModalUsuario() {
  document.getElementById('modal-usuario').style.display = 'none';
}

async function guardarUsuario() {
  const id = document.getElementById('u-id').value;
  const fullName = document.getElementById('u-fullname').value.trim();
  const email = document.getElementById('u-email').value.trim();
  const password = document.getElementById('u-password').value;
  const role = document.getElementById('u-role').value;
  const sede = document.getElementById('u-sede').value;

  if (!fullName || !email || !role || !sede) {
    showAlert('Todos los campos obligatorios deben estar llenos.', 'error');
    return;
  }

  try {
    showLoading('#btn-guardar-usuario', 'Guardando...');

    if (id) {
      // Editar perfil existente
      const activo = document.getElementById('u-estado').value === 'true';
      await updateProfile(id, { full_name: fullName, role, sede, activo });
      showAlert('Usuario actualizado correctamente', 'success');
    } else {
      // Crear nuevo usuario
      if (!password || password.length < 6) {
        hideLoading('#btn-guardar-usuario');
        showAlert('La contraseña debe tener al menos 6 caracteres.', 'error');
        return;
      }
      await createUserWithProfile(email, password, fullName, role, sede);
      showAlert('Usuario creado. Se ha enviado un correo de confirmación (si está habilitado).', 'success');
    }

    cerrarModalUsuario();
    await cargarUsuarios();
  } catch (error) {
    console.error('Error guardando usuario:', error);
    showAlert('Error al guardar: ' + error.message, 'error');
  } finally {
    hideLoading('#btn-guardar-usuario');
  }
}

window.eliminarUsuario = async function(id) {
  const confirmado = await confirmAction('¿Estás seguro de desactivar este usuario? Podrá ser reactivado.');
  if (!confirmado) return;

  try {
    await deleteProfile(id);
    showAlert('Usuario desactivado correctamente', 'success');
    await cargarUsuarios();
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    showAlert('Error al desactivar usuario', 'error');
  }
}
