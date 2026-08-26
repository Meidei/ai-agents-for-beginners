# Biwenger Team Exporter

Una pequeña app web (Node/Express + HTML/JS) para iniciar sesión con tu cuenta
de [Biwenger](https://biwenger.as.com) y descargar los datos de tu equipo en
JSON o CSV.

> ⚠️ **Aviso importante**: Biwenger no ofrece una API pública ni oficial. Esta
> app usa las mismas peticiones que hace la web de Biwenger en el navegador
> (ingeniería inversa no oficial). Puede dejar de funcionar si Biwenger cambia
> su API, y su uso está sujeto a los términos de servicio de Biwenger — úsala
> bajo tu responsabilidad y solo con tu propia cuenta.

## Cómo funciona

- Tu email y contraseña se envían **una sola vez** desde el navegador al
  backend local, que los reenvía a Biwenger para obtener un token de sesión.
- La contraseña **nunca se guarda** (ni en disco, ni en logs, ni en la sesión).
  Solo se guarda el token de Biwenger, en memoria del servidor, asociado a una
  cookie de sesión de esta app.
- Todas las peticiones a Biwenger se hacen desde el backend (no desde el
  navegador), porque la API de Biwenger no permite llamadas CORS directas
  desde otro dominio.

## Requisitos

- Node.js 18 o superior.

## Instalación y uso

```bash
cd biwenger-app
npm install
npm start
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador:

1. Introduce el email y la contraseña de tu cuenta de Biwenger.
2. Elige la liga de la que quieres exportar tu equipo (si estás en varias).
3. Descarga los datos de tu equipo en **JSON** (todo el detalle tal como lo
   devuelve Biwenger) o **CSV** (una fila por jugador).

## Variables de entorno opcionales

- `PORT`: puerto en el que se sirve la app (por defecto `3000`).
- `SESSION_SECRET`: secreto para firmar la cookie de sesión. Si no se define,
  se genera uno aleatorio al arrancar (válido para uso local; en un despliegue
  persistente conviene fijarlo).

## Estructura

```
biwenger-app/
├── server.js           # Backend Express: login, sesión y endpoints de descarga
├── biwengerClient.js    # Cliente HTTP hacia la API no oficial de Biwenger
├── public/               # Frontend estático (HTML/CSS/JS sin frameworks)
└── package.json
```

## Notas sobre los campos exportados

La forma exacta de los datos que devuelve Biwenger (nombres de campos como
`position`, `price`, `points`, etc.) no está documentada oficialmente y puede
variar. El JSON descargado incluye la respuesta completa de Biwenger tal cual,
y el CSV aplana automáticamente todas las claves presentes en cada jugador,
así que ningún dato se pierde aunque cambie el esquema.
