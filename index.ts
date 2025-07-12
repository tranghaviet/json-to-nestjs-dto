import * as fs from "fs";
import * as path from "path";
import { camelCase, upperFirst } from "lodash";

// Configuration
const inputJsonPath = "./input.json";
const outputDir = "./dtos";
// const outputDir = "../template/src/dtos";
const indent = "  ";

// Type mappings for class-validator
const typeToValidator: { [key: string]: string } = {
  string: "IsString",
  number: "IsNumber",
  boolean: "IsBoolean",
  object: "IsObject",
  array: "IsArray",
};

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Read and parse JSON file
const jsonData = JSON.parse(fs.readFileSync(inputJsonPath, "utf-8"));

// Interface for DTO property
interface DtoProperty {
  name: string;
  type: string;
  isArray: boolean;
  isObject: boolean;
  example: any;
  nestedDtoName?: string;
}

// Generate DTO class content
function generateDtoClass(
  className: string,
  properties: DtoProperty[]
): string {
  let imports = [
    "import { ApiProperty } from '@nestjs/swagger';",
    "import { Expose, Type } from 'class-transformer';",
    "import { IsArray, IsBoolean, IsNumber, IsObject, IsString, ValidateNested } from 'class-validator';",
  ];
  let nestedImports: string[] = [];

  // Collect nested DTO imports
  properties.forEach((prop) => {
    if (prop.nestedDtoName) {
      nestedImports.push(
        // `import { ${prop.nestedDtoName} } from './${camelCase(
        //   prop.nestedDtoName
        // )}.dto';`
        `import { ${prop.nestedDtoName} } from './${prop.nestedDtoName}.dto';`
      );
    }
  });

  if (nestedImports.length) {
    imports = [...imports, ...nestedImports];
  }

  let classContent = properties
    .map((prop) => {
      const decorators = [
        `@ApiProperty({ example: ${JSON.stringify(
          prop.example,
          null,
          2
        ).replace(/\n/g, `\n`)} })`,
        `@Expose({ name: '${prop.name}' })`,
      ];

      if (prop.isObject && prop.nestedDtoName) {
        decorators.push(
          `@ValidateNested(${prop.isArray ? "{ each: true }" : ""})`
        );
        decorators.push(`@Type(() => ${prop.nestedDtoName})`);
      } else {
        if (prop.isArray && !prop.nestedDtoName) {
          decorators.push("@IsArray()");
        }

        const validator = typeToValidator[prop.type] || "IsString";
        decorators.push(
          `@${validator}(${prop.isArray ? "{ each: true }" : ""})`
        );
      }

      const property = `${camelCase(prop.name)}: ${prop.type}${
        prop.isArray ? "[]" : ""
      };`;

      return `${[...decorators, property]
        .map((e) => `${indent}${e}`)
        .join(`\n`)}`;
    })
    .join("\n\n");

  return `${imports.join(
    "\n"
  )}\n\nexport class ${className} {\n${classContent}\n}`;
}

// Process JSON to create DTO properties
function processJsonProperties(
  data: any,
  prefix: string = ""
): { props: DtoProperty[]; nestedDtos: Map<string, DtoProperty[]> } {
  const props: DtoProperty[] = [];
  const nestedDtos = new Map<string, DtoProperty[]>();

  for (const [key, value] of Object.entries(data) as [string, any][]) {
    const prop: DtoProperty = {
      name: key,
      type: "string",
      isArray: Array.isArray(value),
      isObject: false,
      example: value,
    };

    let actualValue = prop.isArray && value.length ? value[0] : value;

    if (
      actualValue !== null &&
      typeof actualValue === "object" &&
      !Array.isArray(actualValue)
    ) {
      prop.isObject = true;
      prop.nestedDtoName = upperFirst(camelCase(`${prefix}-${key}`));
      prop.type = prop.nestedDtoName;

      const nestedResult = processJsonProperties(
        actualValue,
        `${prefix}-${key}`
      );
      nestedDtos.set(prop.nestedDtoName, nestedResult.props);
      nestedResult.nestedDtos.forEach((nestedProps, nestedName) => {
        nestedDtos.set(nestedName, nestedProps);
      });
    } else {
      if (
        prop.isArray &&
        actualValue !== undefined &&
        typeof actualValue === "object"
      ) {
        prop.isObject = true;
        prop.nestedDtoName = upperFirst(camelCase(`${prefix}-${key}`));
        prop.type = prop.nestedDtoName;

        const nestedResult = processJsonProperties(
          actualValue,
          `${prefix}-${key}`
        );
        nestedDtos.set(prop.nestedDtoName, nestedResult.props);
        nestedResult.nestedDtos.forEach((nestedProps, nestedName) => {
          nestedDtos.set(nestedName, nestedProps);
        });
      } else {
        prop.type = Array.isArray(value)
          ? typeof (value.length ? value[0] : "string")
          : typeof value;
      }
    }

    props.push(prop);
  }

  return { props, nestedDtos };
}

// Generate all DTO files
function generateDtoFiles(data: any, mainClassName: string) {
  // const { props, nestedDtos } = processJsonProperties(data, mainClassName);
  const { props, nestedDtos } = processJsonProperties(data);

  // Generate main DTO
  const mainDtoContent = generateDtoClass(mainClassName, props);
  fs.writeFileSync(
    // path.join(outputDir, `${camelCase(mainClassName)}.dto.ts`),
    path.join(outputDir, `${mainClassName}.dto.ts`),
    mainDtoContent
  );

  // Generate nested DTOs
  nestedDtos.forEach((nestedProps, nestedClassName) => {
    const nestedDtoContent = generateDtoClass(nestedClassName, nestedProps);
    fs.writeFileSync(
      // path.join(outputDir, `${camelCase(nestedClassName)}.dto.ts`),
      path.join(outputDir, `${nestedClassName}.dto.ts`),
      nestedDtoContent
    );
  });
}

// Example usage
generateDtoFiles(jsonData, "AppConnectionInfo");
