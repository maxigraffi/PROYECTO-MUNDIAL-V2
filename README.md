# OTC · Tournament Options Market

Mercado de opciones sobre resultados de torneos deportivos. Cada equipo es un activo negociable cuyo valor de liquidación depende de su posición final en el torneo.

## Características

- **Order Book en tiempo real** — BID/ASK por equipo, matching automático
- **Multi-usuario simultáneo** — todos los jugadores ven el mismo mercado en vivo (Supabase Realtime)
- **Mark To Market** — PnL calculado a precios de mercado por jugador
- **Liquidación automática** — saldos cruzados al finalizar el torneo
- **Panel Admin** — gestión de equipos, premios, usuarios y órdenes
- **Dark/Light mode** — tema oscuro por defecto

---

## Setup en 3 pasos

### 1 · Crear proyecto Supabase

1. Ir a [supabase.com](https://supabase.com) → **New project**
2. En **SQL Editor** → pegar y ejecutar `supabase/schema.sql`
3. En **Database → Replication** → activar las tablas: `orders`, `trades`, `game_settings`, `teams`, `players`, `prizes`
4. Copiar las credenciales desde **Settings → API**:
   - **Project URL** → `SUPABASE_URL`
   - **anon / public key** → `SUPABASE_ANON_KEY`

### 2 · Configurar credenciales

Abrir `js/app.js` y reemplazar las líneas del tope:

```js
const SUPABASE_URL      = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';
```

### 3 · Publicar en GitHub Pages

```bash
git init
git add .
git commit -m "feat: initial release"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

En GitHub → **Settings → Pages** → Source: `main` branch, `/ (root)` → **Save**

La app quedará disponible en `https://TU_USUARIO.github.io/TU_REPO/`

---

## Guía de uso

### Para el Admin

1. Ir a la pestaña **Admin**
2. Configurar la **Tabla de Premios** (cuánto paga cada posición)
3. Agregar los **jugadores** desde Admin → Usuarios
4. Compartir el link de GitHub Pages con los participantes
5. Al finalizar el torneo: Admin → Configuración → **Liquidar Torneo** (asignar posición final a cada equipo primero)

### Para los Jugadores

1. Abrir el link → seleccionar su usuario
2. Ir a **Mercado** → ingresar BIDs (compra) o ASKs (venta) por equipo
3. Seguir posiciones en **Mi Posición**
4. Ver todos los trades en **Historial**

### Cómo funciona el mercado

- Comprás un equipo pagando una **prima** (en miles $)
- Al liquidar, cobrás el **premio** según la posición final del equipo
- Resultado = Premio cobrado − Prima pagada (para compradores)
- El precio refleja la probabilidad implícita que el mercado le asigna a cada equipo

---

## Estructura del proyecto

```
├── index.html          # UI principal
├── css/
│   └── styles.css      # Estilos
├── js/
│   └── app.js          # Lógica + integración Supabase
├── supabase/
│   └── schema.sql      # Tablas, RLS y datos iniciales
└── README.md
```

---

## Personalización

- **Equipos**: modificar la sección de seed en `supabase/schema.sql` o desde Admin → Equipos
- **Premios**: Admin → Tabla de Premios (editable en vivo)
- **Límites de órdenes**: Admin → Configuración (min/max contratos)
- **Colores**: variables CSS en `css/styles.css` (`:root`)

---

## Notas técnicas

- Sin backend propio — todo corre en el browser con Supabase como BaaS
- El matching engine corre client-side; el admin puede anular trades si hay inconsistencias
- La `anon key` de Supabase es pública por diseño; el acceso está controlado por RLS
- `localStorage` guarda qué usuario seleccionó cada browser entre sesiones

---

*Construido con HTML/CSS/JS vanilla + Supabase + GitHub Pages*
