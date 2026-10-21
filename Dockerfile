FROM node:22-alpine AS frontend-build
WORKDIR /source/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend-build
WORKDIR /source
COPY global.json ./
COPY Directory.Build.props ./
COPY backend/ backend/
COPY --from=frontend-build /source/frontend/dist ./frontend/dist
RUN dotnet restore backend/SelfServiceCheckout.slnx
RUN dotnet publish backend/src/SelfServiceCheckout/SelfServiceCheckout/SelfServiceCheckout.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    Checkout__DatabasePath=/var/lib/goodtable/checkout.db \
    Checkout__MockPaymentsEnabled=true \
    DemoMode__Enabled=false
RUN apt-get update \
    && apt-get install --no-install-recommends -y curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/goodtable \
    && chown "$APP_UID:$APP_UID" /var/lib/goodtable
COPY --from=backend-build /app/publish ./
USER $APP_UID
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["dotnet", "SelfServiceCheckout.dll"]
