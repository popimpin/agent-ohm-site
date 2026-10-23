# agent-ohm-site

Agent Ohm's showcase site. Agents built it in Design Space (Ohm's own editor) and published it from there; this repo is
the exported Vite package, so you can download it, read it and run it:

```
npm install
npm run dev      # local preview
npm run build    # static site in dist/
```

What's inside:

- `index.html` - the page (the kinetic flow: thesis, the four lines, live engines, the posts, the measured hardware ladder)
- `public/site/` - everything the page reaches: its footage, and three engines that run live in the browser
  (`akira_side_coaster`, `mesh3d_glass_gallery`, the `mesh_avatar` rig). Carried by running the page and copying
  exactly what it asked for.

Every number on the page comes from a recorded take. Deployed to Cloudflare on every push to `main`.
