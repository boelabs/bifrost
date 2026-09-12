# Dashboard fonts

Self-hosted variable WOFF2 files from Google Fonts, retrieved September 8, 2026.
Google Sans Flex is used for the interface; Google Sans Code for monospace content.
The accompanying SIL Open Font License files apply to the respective families.

The WOFF2 files themselves live in `public/fonts/`, together with their licences, and are served
at `/fonts/`. They are content-addressed by name and never
change, so `next.config.ts` needs no cache rule for them.

`fonts.css` preserves the upstream Unicode subsets so browsers fetch only required scripts. The root
layout preloads the two regular Latin faces — `font-display: optional` means an unpreloaded face is
skipped rather than swapped in late, so a slow first visit keeps the system fallback until the next
navigation. No Google Fonts requests run in the browser.

## Sources

- [google-sans-code-adlam-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwNS0hkBz.woff2)
- [google-sans-code-canadian-aboriginal-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwJm0hkBz.woff2)
- [google-sans-code-cherokee-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwKW0hkBz.woff2)
- [google-sans-code-math-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwMq0hkBz.woff2)
- [google-sans-code-old-permic-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwNq0hkBz.woff2)
- [google-sans-code-symbols-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwNi0hkBz.woff2)
- [google-sans-code-symbols2-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwAyVo31KpA.woff2)
- [google-sans-code-syriac-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwMW0hkBz.woff2)
- [google-sans-code-vietnamese-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwLm0hkBz.woff2)
- [google-sans-code-latin-ext-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwLi0hkBz.woff2)
- [google-sans-code-latin-italic.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxisyogzv91QhV44Z_GQBHsGf5PuWEt-oWZnOk-ljWSpwaFBwLa0hg.woff2)
- [google-sans-code-adlam-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jEb8LSsgg.woff2)
- [google-sans-code-canadian-aboriginal-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jFW8LSsgg.woff2)
- [google-sans-code-cherokee-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jFq8LSsgg.woff2)
- [google-sans-code-math-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jEF8LSsgg.woff2)
- [google-sans-code-old-permic-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jEV8LSsgg.woff2)
- [google-sans-code-symbols-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jEX8LSsgg.woff2)
- [google-sans-code-symbols2-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jHD0ZGRu3k.woff2)
- [google-sans-code-syriac-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jEK8LSsgg.woff2)
- [google-sans-code-vietnamese-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jF28LSsgg.woff2)
- [google-sans-code-latin-ext-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jF38LSsgg.woff2)
- [google-sans-code-latin-normal.woff2](https://fonts.gstatic.com/s/googlesanscode/v17/pxiSyogzv91QhV44Z_GQBHsGf5PuckJMZfIVTPZaiXEp_jF58LQ.woff2)
- [google-sans-flex-canadian-aboriginal-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4x5hg2a2c.woff2)
- [google-sans-flex-cherokee-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4x2hg2a2c.woff2)
- [google-sans-flex-math-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xtRg2a2c.woff2)
- [google-sans-flex-nushu-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xthg2a2c.woff2)
- [google-sans-flex-symbols-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xpxg2a2c.woff2)
- [google-sans-flex-syriac-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xuhg2a2c.woff2)
- [google-sans-flex-tifinagh-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4x6Rg2a2c.woff2)
- [google-sans-flex-vietnamese-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xxhg2a2c.woff2)
- [google-sans-flex-latin-ext-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xxxg2a2c.woff2)
- [google-sans-flex-latin-normal.woff2](https://fonts.gstatic.com/s/googlesansflex/v22/t5s6IQcYNIWbFgDgAAzZ34auoVyXkJCOvp3SFWJbN5hF8Ju1x6sKCyp0l9sI40swNJwInycYAJzz0m7kJ4qFQOJBOjLvDSndo0SKMpKSTzwliVdHAy4xyRg2.woff2)
