import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    // Bound at the method level (@UsePipes on the handler, not a single @Body() param), this
    // pipe runs for every parameter — @Param('id') and @Query() included. Only the body is
    // actually shaped like the schema; validating the id string against it always failed with
    // "expected object, received string", which silently broke every PATCH endpoint's id param.
    if (metadata.type !== 'body') {
      return value;
    }
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
