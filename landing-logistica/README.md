# Landing Page Corporativa - Empliados.net SOL

Landing page corporativa para el producto SOL (Orquestación operativa del transporte) de Empliados.net.

## 📋 Descripción

Sitio estático HTML/CSS/JS responsive que replica el diseño aprobado de Google Stitch. Enfoque en logística de transporte terrestre con agentes de IA supervisados por criterio humano.

## 🚀 Deployment

Este sitio está preparado para servirse desde Easypanel mediante Docker/nginx.

### Build local

```bash
docker build -t empliados-landing .
docker run -p 8080:80 empliados-landing
```

Acceder en: http://localhost:8080

### Sub-path Support

El sitio funciona tanto en la raíz (`/`) como bajo cualquier sub-ruta (ej: `/borrador-web/`):

- **Rutas relativas**: Todos los assets (CSS, JS, imágenes) usan rutas relativas sin `/` inicial
- **nginx configurado**: El servidor maneja correctamente requests bajo sub-paths
- **Anchor links**: Los links internos (#solucion, #agentes, etc.) funcionan correctamente

Ejemplo de acceso bajo sub-path:
```
https://sol.nivel41.com/borrador-web/
```

## ⚠️ Notas Importantes

### 1. Draft Mode (noindex)

El HTML incluye `<meta name="robots" content="noindex">` en el `<head>` para evitar indexación por motores de búsqueda.

**Para producción final**: Eliminar esta línea del `index.html` (línea 8).

### 2. Email de Contacto

Los botones CTA "Solicitar demo" apuntan a un placeholder:

```html
mailto:contacto@empliados.net
```

**Acción requerida**: Raul debe confirmar el email real de contacto y actualizar:
- Línea 42 del index.html (header CTA)
- Línea 87 del index.html (hero CTA)
- Línea 663 del index.html (CTA final)

### 3. Sin Métricas Inventadas

Se eliminaron todas las estadísticas/métricas falsas del diseño Stitch original:
- ❌ "148 Viajes en Tránsito", "ETA 98.4% Cumplido"
- ❌ Nombres de conductores inventados (ej: "Marcos V. ID: TR-892")
- ❌ Rutas específicas falsas (ej: "Ruta BR-101")

Se reemplazaron por textos descriptivos genéricos que mantienen el concepto sin mentir con datos.

## 📁 Estructura

```
landing-logistica/
├── index.html           # Página principal
├── styles.css           # Estilos completos
├── script.js            # Menu móvil y navegación
├── nginx.conf           # Configuración nginx (gzip, cache, sub-paths)
├── Dockerfile           # Build nginx:alpine
├── assets/              # Imágenes locales (sin branding de terceros)
│   ├── hero-camiones.jpg
│   ├── centro-control.jpg
│   ├── chofer-whatsapp.jpg
│   ├── deposito.jpg
│   ├── entrega-firma.jpg
│   └── supervisor.jpg
└── README.md
```

## ✨ Características

- ✅ Responsive design (desktop, tablet, mobile)
- ✅ Menú hamburguesa funcional para móvil
- ✅ Smooth scroll en navegación anchor
- ✅ Active link highlighting on scroll
- ✅ SEO meta tags (title, description, OG)
- ✅ Favicon (emoji truck 🚚)
- ✅ Accessible alt texts en español
- ✅ Imágenes locales optimizadas
- ✅ Material Symbols icons
- ✅ Plus Jakarta Sans typography
- ✅ Gzip compression
- ✅ Cache headers para assets estáticos
- ✅ Security headers (X-Frame-Options, etc.)

## 🎨 Diseño

Basado en el diseño de Google Stitch con:
- **Colores principales**: Violeta #A334FE, Azul marino #0F1B3D
- **Tipografía**: Plus Jakarta Sans (Google Fonts)
- **Iconografía**: Material Symbols Outlined
- **Estilo**: Corporate, profesional, enfoque B2B logística

## 📱 Secciones

1. **Hero**: Propuesta de valor principal + visual de flota
2. **Problemas**: 4 cuellos de botella críticos
3. **Qué es SOL**: Arquitectura operativa IA + humano
4. **Cómo funciona**: 10 pasos del flujo logístico
5. **Agentes IA**: 10 agentes especializados
6. **Mesa Operativa**: 3 roles + flujo Human-in-the-loop
7. **Capas transversales**: WhatsApp, Chat, Analytics, Gobierno
8. **Beneficios**: Impacto operacional + perfiles objetivo
9. **CTA Final**: Formulario de contacto
10. **Footer**: Links, info ISO 27001, copyright

## 🧪 Testing Local

Para verificar el funcionamiento bajo sub-path:

```bash
# Build
docker build -t test-landing .

# Run en diferentes paths (simulando Easypanel routing)
docker run -p 8080:80 test-landing

# Probar:
# - http://localhost:8080/           -> Debe funcionar
# - http://localhost:8080/test/      -> Debe funcionar (nginx rewrite)
```

## 📝 Mantenimiento

- **Actualizar email**: Buscar `contacto@empliados.net` y reemplazar
- **Quitar noindex**: Eliminar línea 8 del index.html para producción
- **Optimizar imágenes**: Considerar conversión a WebP + fallback JPG para mejor performance
- **Analytics**: Agregar Google Analytics / Plausible cuando esté en producción

## 🔧 Tecnologías

- HTML5 semántico
- CSS3 (custom, no frameworks)
- Vanilla JavaScript (ES6+)
- nginx:alpine (Docker)
- Google Fonts (Plus Jakarta Sans)
- Material Symbols (Google Icons)

---

**Versión**: 1.0.0  
**Fecha**: Noviembre 2026  
**Contacto**: Raul (confirmar email)
