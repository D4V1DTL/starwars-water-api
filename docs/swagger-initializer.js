window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: "openapi.yml",
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis],
    layout: "BaseLayout",
  });
};
