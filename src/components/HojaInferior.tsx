import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { CURVA_CSS, DURACION, HOJA } from '../theme/motion';
import { useReducirMovimiento } from '../hooks/useReducirMovimiento';
import { useInsetsSeguros } from './ZonaSegura';

// Hoja inferior de la tanda visual: reemplaza a los modales centrados de
// confirmación e información. Sube desde abajo en 600 ms con la curva de la
// app y se cierra en 200 ms: tocando afuera, con Escape, con los botones
// propios del contenido, o ARRASTRÁNDOLA hacia abajo (desde cualquier parte
// que no sea una lista con scroll):
//   * si se arrastró más del 30 % de su alto, o se soltó con un "flick"
//     (más de 0.5 px/ms hacia abajo), se cierra;
//   * si no, vuelve a su lugar.
// Mientras sigue al dedo solo cambia el transform (y la opacidad del fondo),
// escrito directo en el DOM: nada de re-render ni de layout por cuadro.
//
// `cerrable={false}` mientras hay una acción en curso (ej. "Confirmar" ya
// enviado): no se cierra deslizando, ni tocando afuera, ni con Escape.
//
// La visibilidad la maneja el padre con `visible`: al pasar a false la hoja
// se anima hacia abajo y RECIÉN después se desmonta, mostrando mientras tanto
// el último contenido (aunque el padre ya haya limpiado sus datos).
//
// Con "reducir movimiento": abre y cierra con fundido, sin desplazarse.
// En nativo: Modal "slide" de siempre, sin arrastre.

const ES_WEB = Platform.OS === 'web';
const UMBRAL_ARRASTRE = 8; // px antes de decidir que es un arrastre (y no un toque)

type HojaInferiorProps = {
  visible: boolean;
  onClose: () => void;
  cerrable?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  testIDFondo?: string;
};

export default function HojaInferior({
  visible,
  onClose,
  cerrable = true,
  children,
  style,
  testID = 'hoja-inferior',
  testIDFondo = 'hoja-inferior-fondo',
}: HojaInferiorProps) {
  const reducir = useReducirMovimiento();
  const { bottom } = useInsetsSeguros();
  const [montada, setMontada] = useState(visible);
  const [saliendo, setSaliendo] = useState(false);
  const hojaRef = useRef<View>(null);
  const fondoRef = useRef<View>(null);
  const ultimoContenido = useRef(children);
  if (visible) ultimoContenido.current = children;
  const cerrableRef = useRef(cerrable);
  cerrableRef.current = cerrable;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setSaliendo(false);
      setMontada(true);
      return undefined;
    }
    if (!montada) return undefined;
    setSaliendo(true);
    const t = setTimeout(() => {
      setMontada(false);
      setSaliendo(false);
    }, DURACION.toque + 40);
    return () => clearTimeout(t);
    // Solo reacciona a `visible`: `montada` es el estado que esto mismo maneja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Arrastre para cerrar (web): eventos de puntero sobre la hoja.
  useEffect(() => {
    if (!ES_WEB || !montada) return undefined;
    const hoja = hojaRef.current as unknown as HTMLElement | null;
    const fondo = fondoRef.current as unknown as HTMLElement | null;
    if (!hoja || typeof hoja.addEventListener !== 'function') return undefined;

    let inicio: { id: number; x: number; y: number } | null = null;
    let arrastrando = false;
    let desplazamiento = 0;
    let muestras: Array<{ t: number; y: number }> = [];

    const pintar = (dy: number) => {
      hoja.style.transform = `translateY(${dy}px)`;
      if (fondo) fondo.style.opacity = String(Math.max(0, 1 - dy / Math.max(hoja.offsetHeight, 1)));
    };
    // Después de arrastrar, el navegador puede mandar un "click" al botón
    // que quedó bajo el dedo (se movió con la hoja): ese click se descarta.
    const tragarClick = () => {
      const tragar = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener('click', tragar, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', tragar, { capture: true }), 400);
    };
    const volver = () => {
      hoja.style.transition = `transform ${DURACION.toque}ms ${CURVA_CSS}`;
      if (fondo) fondo.style.transition = `opacity ${DURACION.toque}ms ${CURVA_CSS}`;
      pintar(0);
      setTimeout(() => {
        hoja.style.transition = '';
        hoja.style.transform = '';
        if (fondo) {
          fondo.style.transition = '';
          fondo.style.opacity = '';
        }
      }, DURACION.toque + 20);
    };

    const alApoyar = (e: PointerEvent) => {
      if (!cerrableRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      inicio = { id: e.pointerId, x: e.clientX, y: e.clientY };
      arrastrando = false;
      desplazamiento = 0;
      muestras = [{ t: e.timeStamp, y: e.clientY }];
    };
    const alMover = (e: PointerEvent) => {
      if (!inicio || e.pointerId !== inicio.id) return;
      const dy = e.clientY - inicio.y;
      if (!arrastrando) {
        if (dy > UMBRAL_ARRASTRE && dy > Math.abs(e.clientX - inicio.x)) {
          arrastrando = true;
          try {
            hoja.setPointerCapture(e.pointerId);
          } catch {
            // sin captura igual funciona mientras el dedo siga sobre la hoja
          }
          hoja.style.transition = 'none';
          if (fondo) fondo.style.transition = 'none';
        } else if (Math.abs(dy) > UMBRAL_ARRASTRE || Math.abs(e.clientX - inicio.x) > UMBRAL_ARRASTRE) {
          inicio = null; // para arriba o de costado: no es un cierre
        }
        return;
      }
      desplazamiento = Math.max(0, dy);
      pintar(desplazamiento);
      muestras.push({ t: e.timeStamp, y: e.clientY });
      if (muestras.length > 6) muestras.shift();
    };
    const alSoltar = (e: PointerEvent) => {
      if (!inicio || e.pointerId !== inicio.id) return;
      inicio = null;
      if (!arrastrando) return;
      arrastrando = false;
      tragarClick();
      const primera = muestras[0];
      const ultima = muestras[muestras.length - 1];
      const velocidad = ultima.t > primera.t ? (ultima.y - primera.y) / (ultima.t - primera.t) : 0;
      if (desplazamiento > hoja.offsetHeight * HOJA.umbralCierre || velocidad > HOJA.velocidadCierre) {
        // Sale desde donde quedó. A mano: el transform escrito durante el
        // arrastre (estilo en línea) le gana a la clase de salida.
        hoja.style.transition = `transform ${DURACION.toque}ms ${CURVA_CSS}`;
        hoja.style.transform = 'translateY(100%)';
        if (fondo) {
          fondo.style.transition = `opacity ${DURACION.toque}ms ${CURVA_CSS}`;
          fondo.style.opacity = '0';
        }
        onCloseRef.current();
      } else {
        volver();
      }
    };
    const alCancelar = (e: PointerEvent) => {
      if (!inicio || e.pointerId !== inicio.id) return;
      inicio = null;
      if (arrastrando) {
        arrastrando = false;
        volver();
      }
    };

    hoja.addEventListener('pointerdown', alApoyar);
    hoja.addEventListener('pointermove', alMover);
    hoja.addEventListener('pointerup', alSoltar);
    hoja.addEventListener('pointercancel', alCancelar);
    return () => {
      hoja.removeEventListener('pointerdown', alApoyar);
      hoja.removeEventListener('pointermove', alMover);
      hoja.removeEventListener('pointerup', alSoltar);
      hoja.removeEventListener('pointercancel', alCancelar);
    };
  }, [montada]);

  if (!montada) return null;
  const contenido = visible ? children : ultimoContenido.current;
  const cerrar = () => {
    if (cerrableRef.current) onClose();
  };

  if (!ES_WEB) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
        <View style={estilos.raiz}>
          <Pressable style={[StyleSheet.absoluteFill, estilos.fondo]} onPress={cerrar} accessible={false} testID={testIDFondo} />
          <View style={[estilos.hoja, { paddingBottom: 20 + bottom }, style]} testID={testID}>
            <View style={estilos.manijaZona}>
              <View style={estilos.manija} />
            </View>
            {contenido}
          </View>
        </View>
      </Modal>
    );
  }

  const animHoja = saliendo ? (reducir ? WEB.hojaSaleFundido : WEB.hojaSale) : reducir ? WEB.hojaEntraFundido : WEB.hojaEntra;
  const animFondo = saliendo ? WEB.fondoSale : WEB.fondoEntra;

  return (
    <Modal visible transparent animationType="none" onRequestClose={cerrar}>
      <View style={estilos.raiz}>
        <Pressable
          ref={fondoRef}
          style={[StyleSheet.absoluteFill, estilos.fondo, animFondo]}
          onPress={cerrar}
          accessible={false}
          testID={testIDFondo}
        />
        <View
          ref={hojaRef}
          style={[estilos.hoja, WEB.sinGestosDelNavegador, { paddingBottom: 20 + bottom }, style, animHoja]}
          testID={testID}
        >
          <View style={estilos.manijaZona}>
            <View style={estilos.manija} />
          </View>
          {contenido}
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, justifyContent: 'flex-end' },
  fondo: { backgroundColor: 'rgba(0,0,0,0.6)' },
  hoja: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.surfaceAlt,
    paddingHorizontal: 20,
  },
  // La manija: el lugar obvio para arrastrar (aunque se puede desde cualquier parte).
  manijaZona: { height: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  manija: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#3F3F46' },
});

// Solo web: animaciones CSS (las corre el compositor) y transiciones.
const SALIDA = {
  transitionProperty: 'transform, opacity',
  transitionDuration: `${DURACION.toque}ms`,
  transitionTimingFunction: CURVA_CSS,
};
const ENTRADA = {
  animationDuration: `${DURACION.aparicion}ms`,
  animationTimingFunction: CURVA_CSS,
  animationFillMode: 'backwards',
};
const WEB: Record<string, any> = ES_WEB
  ? StyleSheet.create({
      // Sin esto el navegador se queda con el gesto (pull-to-refresh, scroll de
      // la página) y la hoja no recibe el arrastre. Las listas con scroll de
      // adentro siguen desplazándose: son su propio contenedor de scroll.
      sinGestosDelNavegador: { touchAction: 'none', overscrollBehavior: 'contain' },
      hojaEntra: {
        ...ENTRADA,
        animationKeyframes: [{ from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0px)' } }],
      },
      hojaEntraFundido: {
        ...ENTRADA,
        animationKeyframes: [{ from: { opacity: 0 }, to: { opacity: 1 } }],
      },
      hojaSale: { ...SALIDA, transform: 'translateY(100%)' },
      hojaSaleFundido: { ...SALIDA, opacity: 0 },
      fondoEntra: {
        ...ENTRADA,
        animationKeyframes: [{ from: { opacity: 0 }, to: { opacity: 1 } }],
      },
      fondoSale: { ...SALIDA, opacity: 0 },
    } as any)
  : {};
