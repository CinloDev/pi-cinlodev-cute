# 🌸 cinlodev-sidebar

Extensión autónoma e interactiva de **Sidebar Multitab** para [Pi Coding Agent](https://github.com/Gentleman-Programming/gentle-pi) y Gentle Shell.

Añade un panel lateral derecho interactivo con pestañas de desarrollo, visualización de commits en tiempo real, explorador de archivos, telemetría de herramientas y estado de memoria persistente.

---

## 🚀 Características

### 📑 4 Pestañas de Desarrollo
* **`1:MAIN`**: Estado del proyecto, rama Git y seguimiento de tareas ODD / TODO.
* **`2:GIT`**:
  * **Grafo de Commits interactivo**: Visualización gráfica coloreada (`git log --graph --oneline`).
  * **Selector de Ramas**: Clic en `[ Ramas ]` para listar ramas locales y remotas.
  * **Working Tree**: Lista de archivos modificados (`+agregados` / `−eliminados`) con clic directo para abrirlos en tu editor.
* **`3:MEM`**:
  * **Engram Memory**: Monitoreo de salud del daemon (:7437), memorias y sesiones con clic para abrir el dashboard web.
  * **Tools Telemetry**: Conteo en tiempo real de llamadas a tools (`read`, `write`, `bash`, `mem_`, `grep`).
* **`4:TREE`**:
  * **Árbol de Proyecto**: Explorador interactivo con soporte de clic para expandir/colapsar carpetas, clic para abrir archivos en el editor y clic derecho para expandir/colapsar todo.

---

## 🖱️ Interacción por Mouse y Scroll

* **Cambio de pestaña por rueda de mouse**: Girar la rueda del mouse sobre la barra superior de pestañas cicla automáticamente entre `MAIN → GIT → MEM → TREE`.
* **Clics directos**:
  * Clic en `[ 1:MAIN ]`, `[ 2:GIT ]`, etc. cambia de solapa al instante.
  * Clic en carpetas del árbol las abre/cierra de forma reactiva.
  * Clic en archivos modificados los abre en tu editor configurado (`$VISUAL`, `$EDITOR` o VS Code).
* **Scroll individual**: Cada tarjeta maneja su propio viewport mediante la rueda del mouse sin perder la contención del sidebar.

---

## 📦 Instalación

### Opción 1: Como extensión local en tu usuario Pi
Copiá o cloná la carpeta dentro de tu directorio de extensiones de Pi:
```bash
# En Windows:
cp -r packages/cinlodev-sidebar ~/.pi/agent/extensions/cinlodev-sidebar

# En Linux/macOS:
cp -r packages/cinlodev-sidebar ~/.pi/agent/extensions/cinlodev-sidebar
```

### Opción 2: Instalación vía Git / NPM
```bash
pi install CinloDev/cinlopi-sidebar
```

### Opción 3: Probar en un workspace local
Agregá la ruta en tu archivo `pi.json` o ejecutá:
```bash
pi -e ./packages/cinlodev-sidebar/index.ts
```

---

## 🛡️ Compatibilidad

* **Windows / macOS / Linux**: Soporta Windows CMD/Batch resolution (`code.cmd`, `notepad.exe`) con aislamiento contra `ENOENT`.
* **Gentle Shell**: Si Gentle Shell está activo, la extensión se conecta automáticamente al estado global del sidebar; si no, monta su propio layout de pantalla completa a partir de 120 columnas.

---

## 📄 Licencia

MIT © CinloDev
