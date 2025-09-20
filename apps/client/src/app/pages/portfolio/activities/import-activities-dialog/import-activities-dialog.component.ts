import { CreateTagDto } from '@ghostfolio/api/app/endpoints/tags/create-tag.dto';
import { CreateAccountWithBalancesDto } from '@ghostfolio/api/app/import/create-account-with-balances.dto';
import { CreateAssetProfileWithMarketDataDto } from '@ghostfolio/api/app/import/create-asset-profile-with-market-data.dto';
import { Activity } from '@ghostfolio/api/app/order/interfaces/activities.interface';
import { GfDialogFooterComponent } from '@ghostfolio/client/components/dialog-footer/dialog-footer.component';
import { GfDialogHeaderComponent } from '@ghostfolio/client/components/dialog-header/dialog-header.component';
import { GfFileDropModule } from '@ghostfolio/client/directives/file-drop/file-drop.module';
import { GfSymbolModule } from '@ghostfolio/client/pipes/symbol/symbol.module';
import { DataService } from '@ghostfolio/client/services/data.service';
import { ImportActivitiesService } from '@ghostfolio/client/services/import-activities.service';
import { PortfolioPosition } from '@ghostfolio/common/interfaces';
import { GfActivitiesTableComponent } from '@ghostfolio/ui/activities-table';

import {
  StepperOrientation,
  StepperSelectionEvent
} from '@angular/cdk/stepper';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SortDirection } from '@angular/material/sort';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { MatTableDataSource } from '@angular/material/table';
import { IonIcon } from '@ionic/angular/standalone';
import { AssetClass } from '@prisma/client';
import { addIcons } from 'ionicons';
import { cloudUploadOutline, warningOutline } from 'ionicons/icons';
import { isArray, sortBy } from 'lodash';
import ms from 'ms';
import { DeviceDetectorService } from 'ngx-device-detector';
import { parse as csvToJson } from 'papaparse';
import type { ParseResult } from 'papaparse';
import { Subject, takeUntil } from 'rxjs';

import { ImportStep } from './enums/import-step';
import { ImportActivitiesDialogParams } from './interfaces/interfaces';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'd-flex flex-column h-100' },
  imports: [
    GfActivitiesTableComponent,
    GfDialogFooterComponent,
    GfDialogHeaderComponent,
    GfFileDropModule,
    GfSymbolModule,
    IonIcon,
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatStepperModule,
    ReactiveFormsModule
  ],
  selector: 'gf-import-activities-dialog',
  styleUrls: ['./import-activities-dialog.scss'],
  templateUrl: 'import-activities-dialog.html'
})
export class GfImportActivitiesDialog implements OnDestroy {
  public accounts: CreateAccountWithBalancesDto[] = [];
  public activities: Activity[] = [];
  public columnMappingForm: FormGroup;
  public assetProfileForm: FormGroup;
  public assetProfiles: CreateAssetProfileWithMarketDataDto[] = [];
  public columnMappingDefinitions: {
    hint?: string;
    key: string;
    label: string;
    required: boolean;
  }[] = [
    {
      key: 'date',
      label: $localize`Activity Date`,
      required: true
    },
    {
      key: 'type',
      label: $localize`Activity Type`,
      required: true,
      hint: $localize`Accepted values: buy, sell, dividend, fee, interest, liability`
    },
    {
      key: 'symbol',
      label: $localize`Symbol`,
      required: true
    },
    {
      key: 'quantity',
      label: $localize`Quantity`,
      required: true
    },
    {
      key: 'unitprice',
      label: $localize`Unit Price`,
      required: true
    },
    {
      key: 'fee',
      label: $localize`Fee`,
      required: true,
      hint: $localize`Use 0 if your CSV has no fee column`
    },
    {
      key: 'currency',
      label: $localize`Currency`,
      required: true
    },
    {
      key: 'datasource',
      label: $localize`Data Source`,
      required: false,
      hint: $localize`Optional – map when the file includes the original data provider`
    },
    {
      key: 'account',
      label: $localize`Account`,
      required: false
    },
    {
      key: 'comment',
      label: $localize`Comment`,
      required: false
    }
  ];
  public dataSource: MatTableDataSource<Activity>;
  public details: any[] = [];
  public deviceType: string;
  public dialogTitle = $localize`Import Activities`;
  public errorMessages: string[] = [];
  public holdings: PortfolioPosition[] = [];
  public importStep: ImportStep = ImportStep.UPLOAD_FILE;
  public isLoading = false;
  public maxSafeInteger = Number.MAX_SAFE_INTEGER;
  public mode: 'DIVIDEND';
  public ImportStepEnum = ImportStep;
  public csvColumns: string[] = [];
  public csvPreviewRows: Record<string, unknown>[] = [];
  public isCsvUpload = false;
  public mappingErrorMessage: string;
  public selectedActivities: Activity[] = [];
  public sortColumn = 'date';
  public sortDirection: SortDirection = 'desc';
  public stepperOrientation: StepperOrientation;
  public tags: CreateTagDto[] = [];
  public totalItems: number;
  private pendingCsvFileContent: string;

  private unsubscribeSubject = new Subject<void>();
  private columnSynonymMap: Record<string, string[]> = {
    account: ['account', 'account id', 'accountid'],
    comment: ['comment', 'note', 'notes'],
    currency: ['currency', 'ccy', 'currency primary'],
    datasource: ['datasource', 'data source'],
    date: ['date', 'trade date', 'transaction date'],
    fee: ['fee', 'commission', 'ib commission'],
    quantity: ['quantity', 'qty', 'units', 'shares'],
    symbol: ['symbol', 'ticker', 'code'],
    type: ['type', 'action', 'buy/sell'],
    unitprice: ['unit price', 'unitprice', 'price', 'trade price', 'value']
  };

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    @Inject(MAT_DIALOG_DATA) public data: ImportActivitiesDialogParams,
    private dataService: DataService,
    private deviceService: DeviceDetectorService,
    private formBuilder: FormBuilder,
    public dialogRef: MatDialogRef<GfImportActivitiesDialog>,
    private importActivitiesService: ImportActivitiesService,
    private snackBar: MatSnackBar
  ) {
    addIcons({ cloudUploadOutline, warningOutline });
  }

  public ngOnInit() {
    this.deviceType = this.deviceService.getDeviceInfo().deviceType;
    this.stepperOrientation =
      this.deviceType === 'mobile' ? 'vertical' : 'horizontal';

    this.assetProfileForm = this.formBuilder.group({
      assetProfileIdentifier: [undefined, Validators.required]
    });

    if (
      this.data?.activityTypes?.length === 1 &&
      this.data?.activityTypes?.[0] === 'DIVIDEND'
    ) {
      this.isLoading = true;

      this.dialogTitle = $localize`Import Dividends`;
      this.mode = 'DIVIDEND';
      this.assetProfileForm.get('assetProfileIdentifier').disable();

      this.dataService
        .fetchPortfolioHoldings({
          filters: [
            {
              id: AssetClass.EQUITY,
              type: 'ASSET_CLASS'
            },
            {
              id: AssetClass.FIXED_INCOME,
              type: 'ASSET_CLASS'
            }
          ],
          range: 'max'
        })
        .pipe(takeUntil(this.unsubscribeSubject))
        .subscribe(({ holdings }) => {
          this.holdings = sortBy(holdings, ({ name }) => {
            return name.toLowerCase();
          });
          this.assetProfileForm.get('assetProfileIdentifier').enable();

          this.isLoading = false;

          this.changeDetectorRef.markForCheck();
        });
    }
  }

  public onCancel() {
    this.dialogRef.close();
  }

  public async onImportActivities() {
    try {
      this.snackBar.open('⏳ ' + $localize`Importing data...`);

      await this.importActivitiesService.importSelectedActivities({
        accounts: this.accounts,
        activities: this.selectedActivities,
        assetProfiles: this.assetProfiles,
        tags: this.tags
      });

      this.snackBar.open(
        '✅ ' + $localize`Import has been completed`,
        undefined,
        {
          duration: ms('3 seconds')
        }
      );
    } catch (error) {
      this.snackBar.open(
        $localize`Oops! Something went wrong.` +
          ' ' +
          $localize`Please try again later.`,
        $localize`Okay`,
        {
          duration: ms('3 seconds')
        }
      );
    } finally {
      this.dialogRef.close();
    }
  }

  public onFilesDropped({
    files,
    stepper
  }: {
    files: FileList;
    stepper: MatStepper;
  }) {
    if (files.length === 0) {
      return;
    }

    this.handleFile({ stepper, file: files[0] });
  }

  public onImportStepChange(event: StepperSelectionEvent) {
    this.importStep = event.selectedIndex as ImportStep;
  }

  public onLoadDividends(aStepper: MatStepper) {
    this.assetProfileForm.get('assetProfileIdentifier').disable();

    const { dataSource, symbol } = this.assetProfileForm.get(
      'assetProfileIdentifier'
    ).value;

    this.dataService
      .fetchDividendsImport({
        dataSource,
        symbol
      })
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe(({ activities }) => {
        this.activities = activities;
        this.dataSource = new MatTableDataSource(activities.reverse());
        this.totalItems = activities.length;

        aStepper.next();

        this.changeDetectorRef.markForCheck();
      });
  }

  public onReset(aStepper: MatStepper) {
    this.details = [];
    this.errorMessages = [];
    if (this.isCsvUpload) {
      this.importStep = ImportStep.MAP_COLUMNS;
      this.selectedActivities = [];
      aStepper.selectedIndex = ImportStep.MAP_COLUMNS;
    } else {
      this.importStep = ImportStep.UPLOAD_FILE;
      this.clearCsvMappingState();
      this.assetProfileForm.get('assetProfileIdentifier').enable();
      aStepper.reset();
    }

    this.changeDetectorRef.markForCheck();
  }

  public onSelectFile(stepper: MatStepper) {
    const input = document.createElement('input');
    input.accept = 'application/JSON, .csv';
    input.type = 'file';

    input.onchange = (event) => {
      // Getting the file reference
      const file = (event.target as HTMLInputElement).files[0];
      this.handleFile({ file, stepper });
    };

    input.click();
  }

  public updateSelection(activities: Activity[]) {
    this.selectedActivities = activities.filter(({ error }) => {
      return !error;
    });
  }

  public onBackToFileSelection(stepper: MatStepper) {
    this.importStep = ImportStep.UPLOAD_FILE;
    this.clearCsvMappingState();
    stepper.reset();
    this.changeDetectorRef.markForCheck();
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  public onApplyColumnMapping(stepper: MatStepper) {
    if (!this.columnMappingForm?.valid) {
      this.columnMappingForm.markAllAsTouched();
      return;
    }

    this.mappingErrorMessage = undefined;
    this.errorMessages = [];
    this.details = [];
    const mapping = this.getHeaderMappingFromForm();

    this.snackBar.open('⏳ ' + $localize`Parsing data...`);

    this.importActivitiesService
      .importCsv({
        columnMapping: mapping,
        fileContent: this.pendingCsvFileContent,
        isDryRun: true,
        userAccounts: this.data.user.accounts
      })
      .then(({ activities }) => {
        this.activities = activities;
        this.dataSource = new MatTableDataSource(activities.reverse());
        this.totalItems = activities.length;
        this.importStep = ImportStep.SELECT_ACTIVITIES;
        stepper.next();
        this.updateSelection(this.activities);
      })
      .catch((error) => {
        console.error(error);
        this.mappingErrorMessage =
          error?.error?.message?.[0] ??
          error?.message ??
          $localize`Unexpected format`;
        this.errorMessages = error?.error?.message ?? [];
      })
      .finally(() => {
        this.snackBar.dismiss();
        this.changeDetectorRef.markForCheck();
      });
  }

  private buildColumnMappingForm(columns: string[]) {
    const formConfig: Record<string, any[]> = {};
    const usedColumns = new Set<string>();

    for (const definition of this.columnMappingDefinitions) {
      const defaultColumn = this.findDefaultColumnForKey(
        definition.key,
        columns,
        usedColumns
      );

      formConfig[definition.key] = [
        defaultColumn ?? '',
        definition.required ? [Validators.required] : []
      ];

      if (defaultColumn) {
        usedColumns.add(defaultColumn);
      }
    }

    this.columnMappingForm = this.formBuilder.group(formConfig);
  }

  private findDefaultColumnForKey(
    key: string,
    columns: string[],
    usedColumns: Set<string>
  ) {
    const synonyms = this.columnSynonymMap[key] ?? [];
    const normalisedSynonyms = synonyms.map((synonym) => {
      return synonym.toLowerCase();
    });

    return columns.find((column) => {
      if (!column || usedColumns.has(column)) {
        return false;
      }

      const normalisedColumn = column.trim().toLowerCase();

      return normalisedSynonyms.some((synonym) => {
        return (
          normalisedColumn === synonym || normalisedColumn.includes(synonym)
        );
      });
    });
  }

  private getHeaderMappingFromForm() {
    const mapping: Record<string, string> = {};

    Object.entries(this.columnMappingForm.value).forEach(([key, value]) => {
      if (value) {
        mapping[key] = value as string;
      }
    });

    return mapping;
  }

  private clearCsvMappingState() {
    this.pendingCsvFileContent = undefined;
    this.csvColumns = [];
    this.csvPreviewRows = [];
    this.columnMappingForm = undefined;
    this.isCsvUpload = false;
    this.mappingErrorMessage = undefined;
  }

  private async handleFile({
    file,
    stepper
  }: {
    file: File;
    stepper: MatStepper;
  }): Promise<void> {
    this.snackBar.open('⏳ ' + $localize`Validating data...`);

    // Setting up the reader
    const reader = new FileReader();
    reader.readAsText(file, 'UTF-8');

    reader.onload = async (readerEvent) => {
      const fileContent = readerEvent.target.result as string;
      const fileExtension = file.name.split('.').pop()?.toLowerCase();

      try {
        this.isCsvUpload = false;
        this.pendingCsvFileContent = undefined;
        this.csvColumns = [];
        this.csvPreviewRows = [];
        this.columnMappingForm = undefined;
        this.mappingErrorMessage = undefined;
        if (fileExtension === 'json') {
          const content = JSON.parse(fileContent);

          this.accounts = content.accounts;
          this.assetProfiles = content.assetProfiles;
          this.tags = content.tags;

          if (!isArray(content.activities)) {
            if (isArray(content.orders)) {
              this.handleImportError({
                activities: [],
                error: {
                  error: {
                    message: [`orders needs to be renamed to activities`]
                  }
                }
              });
              return;
            } else {
              throw new Error();
            }
          }

          content.activities = content.activities.map((activity) => {
            if (activity.id) {
              delete activity.id;
            }

            return activity;
          });

          try {
            const { activities } =
              await this.importActivitiesService.importJson({
                accounts: content.accounts,
                activities: content.activities,
                assetProfiles: content.assetProfiles,
                isDryRun: true,
                tags: content.tags
              });
            this.activities = activities;
            this.dataSource = new MatTableDataSource(activities.reverse());
            this.totalItems = activities.length;
          } catch (error) {
            console.error(error);
            this.handleImportError({ error, activities: content.activities });
          }

          return;
        } else if (fileExtension === 'csv') {
          try {
            const parsed = csvToJson(fileContent, {
              header: true,
              skipEmptyLines: true
            }) as ParseResult<Record<string, unknown>>;

            this.pendingCsvFileContent = fileContent;
            this.csvColumns = (parsed.meta?.fields ?? []).filter((field) => {
              return !!field;
            });
            this.csvPreviewRows = (parsed.data ?? []).slice(0, 5);
            this.isCsvUpload = true;
            this.activities = [];
            this.dataSource = undefined;
            this.totalItems = undefined;
            this.errorMessages = [];
            this.details = [];
            this.mappingErrorMessage = undefined;
            this.buildColumnMappingForm(this.csvColumns);

            this.importStep = ImportStep.MAP_COLUMNS;
            stepper.next();
            return;
          } catch (error) {
            console.error(error);
            this.handleImportError({
              activities: [],
              error: {
                error: { message: [error?.message ?? 'Unexpected format'] }
              }
            });
            return;
          }
        }

        throw new Error();
      } catch (error) {
        console.error(error);
        this.handleImportError({
          activities: [],
          error: { error: { message: ['Unexpected format'] } }
        });
      } finally {
        if (!this.isCsvUpload) {
          this.importStep = ImportStep.SELECT_ACTIVITIES;
          stepper.selectedIndex = ImportStep.SELECT_ACTIVITIES;
        }
        this.snackBar.dismiss();
        this.updateSelection(this.activities);

        this.changeDetectorRef.markForCheck();
      }
    };
  }

  private handleImportError({
    activities,
    error
  }: {
    activities: any[];
    error: any;
  }) {
    this.errorMessages = error?.error?.message;

    for (const message of this.errorMessages) {
      if (message.includes('activities.')) {
        let [index] = message.split(' ');
        index = index.replace('activities.', '');
        [index] = index.split('.');

        this.details.push(activities[index]);
      } else {
        this.details.push('');
      }
    }

    this.changeDetectorRef.markForCheck();
  }
}
