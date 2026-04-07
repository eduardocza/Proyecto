# Sistema de Seguimiento de Vulnerabilidades

Aplicación web para monitorear y hacer seguimiento diario de vulnerabilidades de seguridad.

## Características

- Carga de 2 archivos CSV diarios (remediaciones y equipos)
- Top 5 de remediaciones con más vulnerabilidades
- Comparación automática con datos del día anterior
- Histórico de hasta 30 días
- Exportación de datos históricos
- Almacenamiento local (no requiere servidor)

## Uso

1. Abre `index.html` en tu navegador
2. Carga el archivo CSV de remediaciones (debe contener: Remediation, Description, Vulnerabilities)
3. Carga el archivo CSV de equipos (opcional)
4. Haz clic en "Procesar Datos"
5. Los datos se guardan automáticamente en el navegador

## Formato de CSV

### Archivo de Remediaciones
```
Remediation,Description,Vulnerabilities
Update Microsoft Windows 11,Update Microsoft Windows 11 by installing...,300
Update Oracle JRE,Complete the remediation steps...,49
```

### Archivo de Equipos
```
Equipment,Vulnerabilities
SERVER-01,15
DESKTOP-02,8
```

## Notas

- Los datos se almacenan en localStorage del navegador
- Se mantiene un histórico de 30 días
- Puedes exportar el histórico en formato CSV
