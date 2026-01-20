import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
    const config = new DocumentBuilder()
    .setTitle('Starsoft Backend Challenge')
    .setDescription('API para gerenciamento de sessões de cinema e assentos.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule
    .createDocument(app, config);

  SwaggerModule.setup('api-docs', app, documentFactory());
  await app.listen(3000);
}
bootstrap();
