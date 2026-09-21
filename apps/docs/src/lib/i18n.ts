import type { I18nConfig } from "fumadocs-core/i18n";

export type Locale = "en" | "es";

export const i18n: I18nConfig<Locale> = {
	defaultLanguage: "en",
	languages: ["en", "es"],
	hideLocale: "default-locale",
	fallbackLanguage: null,
};

export function localizedPath(path: string, locale: Locale): string {
	const unprefixed = path === "/es" ? "/" : path.replace(/^\/es\//, "/");
	return locale === "en"
		? unprefixed
		: `/es${unprefixed === "/" ? "" : unprefixed}`;
}

export const spanishUI = {
	"Choose a language(language switcher)": "Elegir idioma",
	"Choose a language(language switcher)(aria-label)": "Elegir idioma",
	"Close Search(search dialog)(aria-label)": "Cerrar búsqueda",
	"Close Sidebar(aria-label)": "Cerrar navegación",
	"Close Sidebar(sidebar)(aria-label)": "Cerrar navegación",
	"Collapse Sidebar(sidebar)(aria-label)": "Contraer navegación",
	"Copied Text(code block)(aria-label)": "Texto copiado",
	"Copy Anchor Link(heading anchor)(aria-label)":
		"Copiar enlace a esta sección",
	"Copy Link(accordion)(aria-label)": "Copiar enlace",
	"Copy Text(code block)(aria-label)": "Copiar texto",
	"Dark(theme switcher)(aria-label)": "Oscuro",
	"Edit on GitHub(edit page)": "Editar en GitHub",
	"Hide Sidebar(sidebar)": "Ocultar navegación",
	"Last updated on(page footer)": "Última actualización",
	"Layout Tab(layout tab trigger)": "Sección de documentación",
	"Light(theme switcher)(aria-label)": "Claro",
	"Next Page(pagination)": "Página siguiente",
	"No Headings(table of contents)": "Sin secciones",
	"No results found(search dialog)": "No se encontraron resultados",
	"On this page(table of contents)": "En esta página",
	"Open Search(search trigger)(aria-label)": "Abrir búsqueda",
	"Open Sidebar(sidebar)(aria-label)": "Abrir navegación",
	"Previous Page(pagination)": "Página anterior",
	"Search(search dialog)": "Buscar",
	"Search(search trigger)": "Buscar",
	"Show Sidebar(sidebar)": "Mostrar navegación",
	"System(theme switcher)(aria-label)": "Sistema",
	"Table of Contents(inline table of contents)": "Contenido",
	"Toggle Menu(mobile menu)(aria-label)": "Abrir o cerrar menú",
	"Toggle Theme(theme switcher)(aria-label)": "Cambiar tema",
};
