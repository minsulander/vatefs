// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides

export const vuetifyOptions = {
  theme: {
      defaultTheme: localStorage.theme || "dark",
      themes: {
          light: {
              colors: {
                  primary: "#005f6a",
                  "primary-darken-1": "#008594",
                  secondary: "#ecedee",
                  background: "#c5cdcf",
                  surface: "#eaedef",
                  error: "#d04050"
                },
          },
          dark: {
            colors: {
              primary: "#008594",
              "primary-darken-1": "#005f6a",
              secondary: "#34383b",
              background: "#14181b",
              surface: "#202528",
              error: "#b02030"
            }
          }
      },
  },
}
