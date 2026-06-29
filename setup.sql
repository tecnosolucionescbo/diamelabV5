-- ============================================================
-- SISTEMA DIAMELAB - SCRIPT SQL COMPLETO PARA SUPABASE
-- Ejecutar paso a paso en el SQL Editor de Supabase
-- ============================================================

-- ============================================================
-- PASO 1: Habilitar extensiones necesarias
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PASO 2: Crear tabla de perfiles (usuarios extendidos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'vendedor_bolivar', 'vendedor_guayana', 'vendedor_maturin')),
    sede TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comentarios para documentación
COMMENT ON TABLE public.profiles IS 'Perfiles de usuarios extendidos del sistema de autenticación de Supabase';
COMMENT ON COLUMN public.profiles.role IS 'Roles: admin, vendedor_bolivar, vendedor_guayana, vendedor_maturin';
COMMENT ON COLUMN public.profiles.sede IS 'Sede asignada: Ciudad Bolivar, Ciudad Guayana, Maturin';
COMMENT ON COLUMN public.profiles.activo IS 'Indica si el usuario está activo (TRUE) o desactivado (FALSE)';

-- ============================================================
-- PASO 3: Crear tabla de clientes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social TEXT NOT NULL,
    rif TEXT UNIQUE NOT NULL,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.clientes IS 'Catálogo de clientes del sistema Diamelab';

-- ============================================================
-- PASO 4: Crear tabla de ventas (Notas de Entrega)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ventas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlacion_a2 TEXT UNIQUE NOT NULL,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id),
    vendedor_id UUID NOT NULL REFERENCES public.profiles(id),
    sede TEXT NOT NULL CHECK (sede IN ('Ciudad Bolivar', 'Ciudad Guayana', 'Maturin')),
    fecha_emision DATE NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    monto_total_usd DECIMAL(12,2) NOT NULL,
    tasa_bcv_aplicada DECIMAL(12,4) NOT NULL,
    estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'anulada')),
    notas TEXT,
    numero_factura TEXT,
    monto_iva DECIMAL(12,2) DEFAULT 0,
    fecha_factura DATE,
    total_con_iva DECIMAL(12,2) GENERATED ALWAYS AS (COALESCE(monto_total_usd,0) + COALESCE(monto_iva,0)) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.ventas IS 'Notas de entrega vinculadas al ERP A2';
COMMENT ON COLUMN public.ventas.correlacion_a2 IS 'Correlativo obligatorio del sistema A2 para cruce';
COMMENT ON COLUMN public.ventas.fecha_vencimiento IS 'Fecha maxima de 15 dias para credito';
COMMENT ON COLUMN public.ventas.numero_factura IS 'Número de factura asociada a la nota de entrega (manual)';
COMMENT ON COLUMN public.ventas.monto_iva IS 'Monto del IVA facturado (generalmente 16% del monto base)';
COMMENT ON COLUMN public.ventas.fecha_factura IS 'Fecha de emisión de la factura';
COMMENT ON COLUMN public.ventas.total_con_iva IS 'Monto total de la factura (base + IVA) - calculado automáticamente';

-- ============================================================
-- PASO 5: Crear tabla de items de venta (opcional)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.venta_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id UUID NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
    codigo_producto TEXT,
    descripcion TEXT,
    cantidad DECIMAL(10,2),
    precio_unitario_usd DECIMAL(12,2),
    total_item_usd DECIMAL(12,2)
);

COMMENT ON TABLE public.venta_items IS 'Items opcionales de cada nota de entrega';

-- ============================================================
-- PASO 6: Crear tabla de pagos y comprobantes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id UUID NOT NULL REFERENCES public.ventas(id),
    vendedor_id UUID NOT NULL REFERENCES public.profiles(id),
    fecha_pago DATE NOT NULL,
    monto_pagado_usd DECIMAL(12,2) NOT NULL,
    tasa_usada DECIMAL(12,4) NOT NULL,
    metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('Transferencia', 'Pago Movil', 'Divisas Efectivo', 'Bs Efectivo', 'Zelle', 'Binance')),
    referencia TEXT,
    banco_origen TEXT,
    comprobante_url TEXT,
    retencion_iva_url TEXT,
    retencion_islr_url TEXT,
    validado BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.pagos IS 'Registro de pagos con comprobantes adjuntos';
COMMENT ON COLUMN public.pagos.validado IS 'Indica si el pago ha sido validado (TRUE) o está pendiente (FALSE)';

-- ============================================================
-- PASO 7: Crear índices para optimización
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON public.ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON public.ventas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_ventas_sede ON public.ventas(sede);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON public.ventas(estado);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON public.ventas(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_ventas_correlacion ON public.ventas(correlacion_a2);
CREATE INDEX IF NOT EXISTS idx_ventas_numero_factura ON public.ventas(numero_factura);
CREATE INDEX IF NOT EXISTS idx_venta_items_venta ON public.venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_venta ON public.pagos(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_vendedor ON public.pagos(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON public.pagos(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_pagos_validado ON public.pagos(validado);

-- ============================================================
-- PASO 8: Habilitar Row Level Security (RLS) en todas las tablas
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venta_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PASO 9: Crear funciones auxiliares para RLS
-- ============================================================

-- Funcion para verificar si el usuario es admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funcion para obtener la sede del usuario actual
CREATE OR REPLACE FUNCTION public.current_user_sede()
RETURNS TEXT AS $$
DECLARE
    user_sede TEXT;
BEGIN
    SELECT sede INTO user_sede FROM public.profiles WHERE id = auth.uid();
    RETURN user_sede;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funcion para obtener el rol del usuario actual
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
    RETURN user_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PASO 10: Crear políticas RLS para profiles
-- ============================================================

-- Los usuarios pueden ver su propio perfil
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

-- Los admins pueden ver todos los perfiles
CREATE POLICY "Admins can view all profiles" ON public.profiles
    FOR SELECT USING (public.is_admin());

-- Los admins pueden insertar perfiles
CREATE POLICY "Admins can insert profiles" ON public.profiles
    FOR INSERT WITH CHECK (public.is_admin());

-- Los usuarios pueden actualizar su propio perfil (solo nombre)
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- PASO 11: Crear políticas RLS para clientes
-- ============================================================

-- Todos los usuarios autenticados pueden ver clientes
CREATE POLICY "Authenticated users can view clientes" ON public.clientes
    FOR SELECT TO authenticated USING (true);

-- Todos los usuarios autenticados pueden crear clientes
CREATE POLICY "Authenticated users can insert clientes" ON public.clientes
    FOR INSERT TO authenticated WITH CHECK (true);

-- Solo admins pueden actualizar/eliminar clientes
CREATE POLICY "Admins can update clientes" ON public.clientes
    FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins can delete clientes" ON public.clientes
    FOR DELETE USING (public.is_admin());

-- ============================================================
-- PASO 12: Crear políticas RLS para ventas
-- ============================================================

-- Vendedores solo ven ventas de su sede, admins ven todas
CREATE POLICY "Users can view ventas" ON public.ventas
    FOR SELECT USING (
        public.is_admin() 
        OR sede = public.current_user_sede()
    );

-- Vendedores solo crean ventas de su sede, admins pueden crear cualquiera
CREATE POLICY "Users can insert ventas" ON public.ventas
    FOR INSERT WITH CHECK (
        public.is_admin() 
        OR sede = public.current_user_sede()
    );

-- Vendedores solo actualizan ventas de su sede (no anuladas)
CREATE POLICY "Users can update ventas" ON public.ventas
    FOR UPDATE USING (
        public.is_admin() 
        OR (sede = public.current_user_sede() AND estado != 'anulada')
    );

-- Solo admins pueden eliminar ventas
CREATE POLICY "Admins can delete ventas" ON public.ventas
    FOR DELETE USING (public.is_admin());

-- ============================================================
-- PASO 13: Crear políticas RLS para venta_items
-- ============================================================

CREATE POLICY "Users can view venta_items" ON public.venta_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.ventas v 
            WHERE v.id = venta_items.venta_id 
            AND (public.is_admin() OR v.sede = public.current_user_sede())
        )
    );

CREATE POLICY "Users can insert venta_items" ON public.venta_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.ventas v 
            WHERE v.id = venta_items.venta_id 
            AND (public.is_admin() OR v.sede = public.current_user_sede())
        )
    );

CREATE POLICY "Users can delete venta_items" ON public.venta_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.ventas v 
            WHERE v.id = venta_items.venta_id 
            AND (public.is_admin() OR v.sede = public.current_user_sede())
        )
    );

-- ============================================================
-- PASO 14: Crear políticas RLS para pagos
-- ============================================================

CREATE POLICY "Users can view pagos" ON public.pagos
    FOR SELECT USING (
        public.is_admin() 
        OR EXISTS (
            SELECT 1 FROM public.ventas v 
            WHERE v.id = pagos.venta_id 
            AND v.sede = public.current_user_sede()
        )
    );

CREATE POLICY "Users can insert pagos" ON public.pagos
    FOR INSERT WITH CHECK (
        public.is_admin() 
        OR EXISTS (
            SELECT 1 FROM public.ventas v 
            WHERE v.id = pagos.venta_id 
            AND v.sede = public.current_user_sede()
        )
    );

CREATE POLICY "Users can update pagos" ON public.pagos
    FOR UPDATE USING (
        public.is_admin() 
        OR EXISTS (
            SELECT 1 FROM public.ventas v 
            WHERE v.id = pagos.venta_id 
            AND v.sede = public.current_user_sede()
        )
    );

CREATE POLICY "Admins can delete pagos" ON public.pagos
    FOR DELETE USING (public.is_admin());

-- ============================================================
-- PASO 15: Crear trigger para crear perfil automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role, sede, activo)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        COALESCE(NEW.raw_user_meta_data->>'role', 'vendedor_bolivar'),
        NEW.raw_user_meta_data->>'sede',
        TRUE
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear trigger en auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- PASO 16: Crear función para actualizar estado de venta
-- ============================================================
CREATE OR REPLACE FUNCTION public.actualizar_estado_venta()
RETURNS TRIGGER AS $$
DECLARE
    total_pagado DECIMAL(12,2);
    monto_total DECIMAL(12,2);
BEGIN
    -- Calcular total pagado para esta venta
    SELECT COALESCE(SUM(monto_pagado_usd), 0) INTO total_pagado
    FROM public.pagos
    WHERE venta_id = NEW.venta_id;
    
    -- Obtener monto total de la venta
    SELECT monto_total_usd INTO monto_total
    FROM public.ventas
    WHERE id = NEW.venta_id;
    
    -- Actualizar estado según el pago
    IF total_pagado >= monto_total THEN
        UPDATE public.ventas SET estado = 'pagada' WHERE id = NEW.venta_id;
    ELSIF total_pagado > 0 THEN
        UPDATE public.ventas SET estado = 'parcial' WHERE id = NEW.venta_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para actualizar estado automáticamente al registrar pago
DROP TRIGGER IF EXISTS on_pago_created ON public.pagos;
CREATE TRIGGER on_pago_created
    AFTER INSERT OR UPDATE ON public.pagos
    FOR EACH ROW EXECUTE FUNCTION public.actualizar_estado_venta();

-- ============================================================
-- PASO 17: Insertar usuarios de prueba
-- ============================================================

-- NOTA: Los UUIDs deben coincidir con los creados en auth.users
-- Reemplaza los UUIDs con los reales generados por Supabase Auth

-- Para crear usuarios manualmente en Supabase:
-- 1. Ve a Authentication > Users en el panel de Supabase
-- 2. Click en "New User" o "Add User"
-- 3. Ingresa el email y password
-- 4. En "User Metadata" agrega:
--    {"full_name": "Nombre Completo", "role": "admin|vendedor_xxx", "sede": "Ciudad..."}
-- 5. El trigger creará automáticamente el perfil en public.profiles

-- ============================================================
-- PASO 18: Datos de ejemplo (opcional - para pruebas)
-- ============================================================

-- Insertar clientes de ejemplo
INSERT INTO public.clientes (razon_social, rif, direccion, telefono, email) VALUES
('Laboratorio Central C.A.', 'J-12345678-9', 'Av. Principal, Edif. Central, Piso 3', '0286-1234567', 'contacto@labcentral.com'),
('Clinica Santa Maria', 'J-87654321-0', 'Calle Bolivar, Local 45', '0291-7654321', 'info@santamaria.com'),
('Hospital Universitario', 'G-20000001-2', 'Av. Universidad, Complejo Hospitalario', '0291-9876543', 'admin@huoriental.edu.ve'),
('Laboratorio BioTest', 'J-45678901-2', 'Zona Industrial, Galpon 12', '0285-4567890', 'biotest@gmail.com'),
('Centro Medico Guayana', 'J-98765432-1', 'Av. Las Americas, Torre Medica', '0286-5544332', 'cmg@hotmail.com')
ON CONFLICT (rif) DO NOTHING;

-- ============================================================
-- INSTRUCCIONES PARA CONFIGURAR STORAGE (Buckets)
-- ============================================================
-- Ve a Storage en el panel de Supabase y crea estos buckets:
-- 1. "comprobantes-pagos"
-- 2. "retenciones-iva"
-- 3. "retenciones-islr"
-- Todos deben ser públicos (Public: true)
