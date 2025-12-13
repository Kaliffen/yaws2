#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D hdrColor;
uniform float exposure;
uniform float gamma;

vec3 toneMapACES(vec3 color) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}

void main() {
    vec3 hdr = texture(hdrColor, TexCoord).rgb;
    vec3 mapped = toneMapACES(hdr * max(exposure, 0.0001));
    mapped = pow(mapped, vec3(1.0 / max(gamma, 0.0001)));
    FragColor = vec4(mapped, 1.0);
}
