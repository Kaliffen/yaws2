#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D hdrTex;
uniform float exposure;
uniform float whitePoint;
uniform float gamma;
uniform int enableTonemapping;

vec3 tonemap(vec3 color) {
    float wp = max(whitePoint, 0.0001);
    vec3 mapped = (color * (1.0 + color / (wp * wp))) / (1.0 + color);
    return mapped;
}

void main() {
    vec3 hdrColor = texture(hdrTex, TexCoord).rgb * max(exposure, 0.0);
    vec3 mapped = enableTonemapping == 1 ? tonemap(hdrColor) : hdrColor;
    vec3 ldr = pow(max(mapped, vec3(0.0)), vec3(1.0 / max(gamma, 0.0001)));
    FragColor = vec4(ldr, 1.0);
}
