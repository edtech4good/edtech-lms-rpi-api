import { ApiProperty } from '@nestjs/swagger';

export class IFilter {
    @ApiProperty()
    key?: string = "";
    @ApiProperty()
    value?: string = "";
}

export class IPaging {
    @ApiProperty()
    pageindex?: number = 0;
    @ApiProperty()
    pagesize?: number = 0;
    @ApiProperty({ type: [IFilter] })
    filter?: Array<IFilter>;
}

export class IMultiFilter {
    @ApiProperty()
    key: string = "";
    @ApiProperty()
    value: Array<string> | string = "";
}

export class IMultiPaging {
    @ApiProperty()
    pageindex?: number = 0;
    @ApiProperty()
    pagesize?: number = 0;
    @ApiProperty({ type: [IMultiFilter] })
    filter?: Array<IMultiFilter>;
}
