import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

// Pago por transferencia con comprobante -- ver
// supabase_migration_transferencia_comprobante_fase1.sql (bucket privado
// 'comprobantes-pago' + columnas nuevas de pagos_socio + aprobación/rechazo
// del admin) y supabase_migration_transferencia_comprobante_insert_socio.sql
// (la función que le permite a UN SOCIO crear su propia fila 'pendiente' --
// pagos_socio_admin_write es "solo admin" para insert/update/delete, un
// insert directo del socio queda bloqueado por RLS sin esa función).
//
// A diferencia de avatars/community-media, 'comprobantes-pago' es un bucket
// PRIVADO (pedido explícito -- son comprobantes bancarios). Por eso acá NO
// se llama a getPublicUrl(): esta función devuelve el PATH crudo dentro del
// bucket, que es lo que se guarda en pagos_socio.comprobante_url y lo que
// después usa el admin (o el propio socio) para pedir una URL firmada.

const TIMEOUT_MS = 20000;
const TIMEOUT_MSG = 'La operación tardó demasiado. Revisá tu conexión e intentá de nuevo.';

function isMissingBucketError(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('bucket not found') || error.statusCode === '404';
}

function isMissingFunctionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42883 = undefined_function (Postgres) -- crear_pago_pendiente_transferencia
  // todavía no se corrió en este ambiente.
  if (error.code === '42883' || error.code === 'PGRST202') return true;
  return (error.message ?? '').toLowerCase().includes('function');
}

// Sube la foto del comprobante a la carpeta propia del socio dentro del
// bucket privado. Path con timestamp (no fijo, a diferencia del avatar):
// un socio puede mandar más de un comprobante en el tiempo (packs
// distintos, o un reintento tras un rechazo) y cada uno tiene que quedar
// como un archivo propio, no pisar al anterior.
export async function subirComprobantePago(userId: string, localUri: string): Promise<string> {
  const response = await withTimeout(fetch(localUri), TIMEOUT_MS, TIMEOUT_MSG);
  const blob = await response.blob();
  const ext = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error } = await withTimeout(
    supabase.storage
      .from('comprobantes-pago')
      .upload(path, blob, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` }),
    TIMEOUT_MS,
    TIMEOUT_MSG
  );

  if (error) {
    if (isMissingBucketError(error)) {
      throw Object.assign(new Error('Esta función todavía no está activada. Probá de nuevo más tarde.'), {
        code: 'BUCKET_MISSING',
      });
    }
    throw new Error(error.message);
  }

  return path;
}

export interface CrearPagoPendienteParams {
  packId: string;
  comprobantePath: string;
  monto: number;
}

// Crea la fila 'pendiente' en pagos_socio vía RPC (ver el comentario de
// arriba del archivo -- un insert directo a la tabla lo bloquea RLS).
export async function crearPagoPendiente(params: CrearPagoPendienteParams): Promise<string> {
  const { data, error } = await withTimeout(
    supabase.rpc('crear_pago_pendiente_transferencia', {
      p_pack_id: params.packId,
      p_comprobante_url: params.comprobantePath,
      p_monto: params.monto,
    }),
    TIMEOUT_MS,
    TIMEOUT_MSG
  );

  if (error) {
    if (isMissingFunctionError(error)) {
      throw Object.assign(new Error('Esta función todavía no está activada. Probá de nuevo más tarde.'), {
        code: 'FUNCTION_MISSING',
      });
    }
    throw new Error(error.message);
  }

  return data as string;
}
