FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node src ./src
USER node
ENV PORT=8794 BIND_HOST=0.0.0.0
EXPOSE 8794
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8794/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
