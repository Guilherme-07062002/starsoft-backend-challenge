import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  
  // Validação global dos DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,            // Remove chaves do JSON que não estão no DTO (Segurança)
    forbidNonWhitelisted: true, // Retorna erro 400 se enviarem campos "estranhos"
    transform: true,            // CRUCIAL: Transforma o JSON puro numa instância da Classe DTO
  }));

  const config = new DocumentBuilder()
    .setTitle('Starsoft Backend Challenge')
    .setDescription('API para gerenciamento de sessões de cinema e assentos.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule
    .createDocument(app, config);

  SwaggerModule.setup('api-docs', app, documentFactory());
  await app.listen(parseInt(process.env.PORT || '3000'));
}
bootstrap();
