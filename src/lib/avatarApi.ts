import { supabase } from './supabase';

// Foto de perfil real -- ver backend/supabase_migration_avatar.sql (columna
// profiles.avatar_url + bucket 'avatars'). A diferencia de otros módulos de
// esta app, acá NO hay un modo demo con AsyncStorage: una foto que solo
// "pareciera" sincronizada en esta pantalla pero que en realidad no se ve en
// el Feed/Ranking/Mensajes (que sí dependen 100% del RPC real) sería peor
// que directamente avisar que la función todavía no está activada -- mismo
// criterio de "no fingir sincronización que no existe" que ya se aplicó acá
// con el ranking en modo demo (comunidadApi.ts).

// 42703 = undefined_column (Postgres) -- la migración de avatar todavía no
// corrió en este ambiente.
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  return (error.message ?? '').toLowerCase().includes('column');
}

function isMissingBucketError(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('bucket not found') || error.statusCode === '404';
}

export async function checkAvatarDisponible(): Promise<boolean> {
  const { error } = await supabase.from('profiles').select('avatar_url').limit(1);
  return !(error && isMissingColumnError(error));
}

// Sube (o reemplaza) la foto de perfil y actualiza profiles.avatar_url.
// Path FIJO por usuario (`<user_id>/avatar.<ext>`, sin timestamp) con
// upsert:true a propósito -- una foto nueva pisa a la anterior en el mismo
// lugar del bucket en vez de acumular archivos huérfanos. La URL pública
// devuelta lleva un query param de cache-busting: con un path fijo, sin
// esto el <Image> (y cualquier cache intermedio) puede seguir mostrando la
// foto VIEJA después de reemplazarla porque la URL no cambió de nombre.
export async function subirAvatarPerfil(userId: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true });
  if (uploadError) {
    if (isMissingBucketError(uploadError)) {
      throw Object.assign(new Error('El bucket de avatares todavía no está creado.'), { code: 'BUCKET_MISSING' });
    }
    throw new Error(uploadError.message);
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
  if (updateError) {
    if (isMissingColumnError(updateError)) {
      throw Object.assign(new Error('La columna avatar_url todavía no existe.'), { code: 'COLUMN_MISSING' });
    }
    throw new Error(updateError.message);
  }

  return publicUrl;
}
