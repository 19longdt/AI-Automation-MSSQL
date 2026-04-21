| Schema | TableName | IndexName | IndexType | Uniqueness | Columns | IsPrimaryKey | IsUnique | FillFactor | PartitionScheme |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| dbo | bill | idx\_com\_id\_norm\_quarter\_norm\_date | NONCLUSTERED | NON-UNIQUE | com\_id, norm\_quarter, norm\_date | false | false | 0 | psBillQuarter |
| dbo | bill | idx\_com\_id\_status\_code | NONCLUSTERED | NON-UNIQUE | norm\_quarter, tax\_authority\_code, total\_amount, bill\_date, code, status, com\_id | false | false | 0 | psBillQuarter |
| dbo | bill | idx\_customer\_id | NONCLUSTERED | NON-UNIQUE | customer\_id, norm\_quarter | false | false | 0 | psBillQuarter |
| dbo | bill | idx\_id | NONCLUSTERED | NON-UNIQUE | norm\_quarter, id | false | false | 0 | psBillQuarter |
| dbo | bill | idx\_norm\_quarter\_com\_id\_norm\_date | NONCLUSTERED | NON-UNIQUE | norm\_quarter, com\_id, norm\_date, id | false | false | 0 | psBillQuarter |
| dbo | bill | PK\_bill | CLUSTERED | UNIQUE | norm\_quarter, id | false | true | 0 | psBillQuarter |
| dbo | bill\_product | PK\_bill\_product | CLUSTERED | PRIMARY | id, norm\_quarter | true | true | 0 | psBillProductQuarter |
| dbo | bill\_product | idx\_bill\_id | NONCLUSTERED | NON-UNIQUE | norm\_quarter, bill\_id, total\_pre\_tax, feature, product\_code, com\_id, product\_id | false | false | 0 | psBillProductQuarter |
| dbo | bill\_product | idx\_bill\_product\_ppuId | NONCLUSTERED | NON-UNIQUE | norm\_quarter, product\_product\_unit\_id | false | false | 0 | psBillProductQuarter |
| dbo | bill\_product | idx\_billProduct\_billId\_productCode\_included | NONCLUSTERED | NON-UNIQUE | bill\_id, product\_code, quantity, discount\_amount, vat\_amount, total\_amount, amount, position, norm\_quarter | false | false | 0 | psBillProductQuarter |
| dbo | bill\_product | idx\_billProduct\_productId | NONCLUSTERED | NON-UNIQUE | product\_id, norm\_quarter | false | false | 0 | psBillProductQuarter |
| dbo | bill\_product | idx\_id | NONCLUSTERED | NON-UNIQUE | norm\_quarter, id | false | false | 0 | psBillProductQuarter |
| dbo | customer | PK\_\_customer\_\_3213E83FF30116A5 | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | customer | idx\_Customer\_ComId\_Active\_Type | NONCLUSTERED | NON-UNIQUE | com\_id, active, type, tax\_code, code2, normalized\_name | false | false | 0 | null |
| dbo | customer | idx\_customer\_comId\_name\_active\_included | NONCLUSTERED | NON-UNIQUE | active, name, com\_id, code, phone\_number, tax\_code, code2 | false | false | 0 | null |
| dbo | customer | idx\_customer\_comId\_taxcode\_active\_included | NONCLUSTERED | NON-UNIQUE | com\_id, tax\_code, active, name, code, code2 | false | false | 0 | null |
| dbo | debt | PK\_\_debt\_\_3213E83F45647AD6 | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | debt | idx\_debt\_com\_customer | NONCLUSTERED | NON-UNIQUE | amount, norm\_date, type\_debt, type\_doc, ref\_id, customer\_id, com\_id | false | false | 0 | null |
| dbo | debt | idx\_debt\_comId\_type\_date\_included | NONCLUSTERED | NON-UNIQUE | customer\_name, amount, norm\_date, type\_doc, com\_id | false | false | 0 | null |
| dbo | inventory | inventory\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | inventory | inventory\_com\_id\_ppu\_id\_index | NONCLUSTERED | NON-UNIQUE | ppu\_id, com\_id | false | false | 0 | null |
| dbo | inventory | inventory\_com\_id\_warehouse\_id\_index | NONCLUSTERED | NON-UNIQUE | on\_hand, ppu\_id, product\_id, warehouse\_id, com\_id | false | false | 0 | null |
| dbo | invoice | idx\_bill\_id\_tax\_check\_status | NONCLUSTERED | NON-UNIQUE | bill\_id, tax\_check\_status, norm\_quarter | false | false | 0 | psInvoiceQuarter |
| dbo | invoice | idx\_com\_id\_norm\_quarter\_norm\_date | NONCLUSTERED | NON-UNIQUE | company\_id, norm\_quarter, norm\_date | false | false | 0 | psInvoiceQuarter |
| dbo | invoice | idx\_company\_id\_arising\_date | NONCLUSTERED | NON-UNIQUE | norm\_quarter, tax\_authority\_code, tax\_check\_status, arising\_date, company\_id | false | false | 0 | psInvoiceQuarter |
| dbo | invoice | idx\_company\_id\_bill\_id\_norm\_quarter | NONCLUSTERED | UNIQUE | norm\_quarter, bill\_id, company\_id | false | true | 0 | psInvoiceQuarter |
| dbo | invoice | idx\_id | NONCLUSTERED | NON-UNIQUE | id, norm\_quarter | false | false | 0 | psInvoiceQuarter |
| dbo | invoice | idx\_invoice\_company\_id\_ikey | NONCLUSTERED | NON-UNIQUE | tax\_authority\_code, tax\_check\_status, no, ikey, company\_id, update\_time, norm\_quarter | false | false | 0 | psInvoiceQuarter |
| dbo | invoice | idx\_norm\_quarter\_com\_id\_norm\_date | NONCLUSTERED | NON-UNIQUE | norm\_quarter, company\_id, norm\_date | false | false | 0 | psInvoiceQuarter |
| dbo | invoice | PK\_invoice | CLUSTERED | UNIQUE | id, norm\_quarter | false | true | 0 | psInvoiceQuarter |
| dbo | invoice\_product | idx\_id | NONCLUSTERED | NON-UNIQUE | id, norm\_quarter | false | false | 0 | psInvoiceProductQuarter |
| dbo | invoice\_product | idx\_invoice\_id\_bill\_id | NONCLUSTERED | NON-UNIQUE | invoice\_id, bill\_id, norm\_quarter | false | false | 0 | psInvoiceProductQuarter |
| dbo | invoice\_product | idx\_product\_id | NONCLUSTERED | NON-UNIQUE | product\_id, norm\_quarter | false | false | 0 | psInvoiceProductQuarter |
| dbo | invoice\_product | PK\_invoice\_product | CLUSTERED | UNIQUE | id, norm\_quarter | false | true | 0 | psInvoiceProductQuarter |
| dbo | mc\_payment | PK\_\_mc\_payme\_\_3213E83F4515621A | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | mc\_payment | idx\_mc\_payment\_refId\_typeDoc | NONCLUSTERED | NON-UNIQUE | type\_doc, ref\_id | false | false | 0 | null |
| dbo | mc\_payment | idx\_mcPayment\_comId\_code | NONCLUSTERED | NON-UNIQUE | code, com\_id | false | false | 0 | null |
| dbo | mc\_payment | idx\_mcPayment\_comId\_date\_included | NONCLUSTERED | NON-UNIQUE | amount, customer\_name, date, com\_id | false | false | 0 | null |
| dbo | mc\_receipt | PK\_\_mc\_recei\_\_3213E83F6609728C | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | mc\_receipt | idx\_mc\_receipt\_com\_id\_rs\_inoutward\_id | NONCLUSTERED | NON-UNIQUE | customer\_normalized\_name, payment\_method, business\_type\_id, update\_time, create\_time, updater, creator, description, com\_id, rs\_inoutward\_id, bill\_id, type\_desc, date, no, customer\_id, customer\_name, amount | false | false | 0 | null |
| dbo | mc\_receipt | idx\_mc\_receipt\_refId\_typeDoc | NONCLUSTERED | NON-UNIQUE | type\_doc, ref\_id | false | false | 0 | null |
| dbo | mc\_receipt | idx\_McReceipt\_comId\_rsInoutwardId | NONCLUSTERED | NON-UNIQUE | com\_id, rs\_inoutward\_id, id, no | false | false | 0 | null |
| dbo | mc\_receipt | idx\_mcReceipt\_comId\_type\_date\_included | NONCLUSTERED | NON-UNIQUE | type\_desc, date, id, customer\_name, amount, com\_id | false | false | 0 | null |
| dbo | payment\_history | PK\_\_bill\_pay\_\_3213E83F5E9F4C9D | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | payment\_history | idx\_payment\_history\_refId | NONCLUSTERED | NON-UNIQUE | ref\_id | false | false | 0 | null |
| dbo | product | PK\_\_product\_\_3213E83F6D392813 | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | product | idx\_product\_comId\_active | NONCLUSTERED | NON-UNIQUE | active, com\_id | false | false | 0 | null |
| dbo | product | idx\_product\_comId\_active\_status | NONCLUSTERED | NON-UNIQUE | status, active, com\_id | false | false | 0 | null |
| dbo | product | idx\_product\_comId\_code\_active\_included | NONCLUSTERED | NON-UNIQUE | com\_id, code, active, name, out\_price, image, code2 | false | false | 0 | null |
| dbo | product | idx\_product\_comId\_name\_included | NONCLUSTERED | NON-UNIQUE | com\_id, name, code2, code, active | false | false | 0 | null |
| dbo | product\_group | PK\_\_product\_\_\_3213E83F0EBB298E | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | product\_group | idx\_productGroup\_comId | NONCLUSTERED | NON-UNIQUE | com\_id | false | false | 0 | null |
| dbo | product\_product\_unit | product\_product\_unit\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | product\_product\_unit | idx\_com\_id\_product\_id | NONCLUSTERED | NON-UNIQUE | product\_id, com\_id | false | false | 0 | null |
| dbo | product\_product\_unit | IX\_ppu\_primary\_productid | NONCLUSTERED | NON-UNIQUE | unit\_name, product\_unit\_id, product\_id | false | false | 0 | null |
| dbo | product\_product\_unit | IX\_product\_product\_unit\_productId\_isPrimary | NONCLUSTERED | NON-UNIQUE | product\_id, is\_primary, product\_unit\_id, unit\_name, min\_quantity | false | false | 0 | null |
| dbo | product\_product\_unit | product\_product\_unit\_com\_id\_index | NONCLUSTERED | NON-UNIQUE | com\_id, is\_primary, id, parent\_id | false | false | 0 | null |
| dbo | product\_product\_unit | product\_product\_unit\_product\_unit\_id\_index | NONCLUSTERED | NON-UNIQUE | product\_unit\_id | false | false | 0 | null |
| dbo | product\_unit | product\_unit\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | product\_unit | idx\_productUnit\_comId | NONCLUSTERED | NON-UNIQUE | com\_id | false | false | 0 | null |
| dbo | product\_unit | uix\_product\_unit\_comId\_name | NONCLUSTERED | UNIQUE | com\_id, name | false | true | 0 | null |
| dbo | rs\_inoutward | PK\_RsInOutWard | CLUSTERED | PRIMARY | norm\_quarter, id | true | true | 0 | psRsInOutWardQuarter |
| dbo | rs\_inoutward | idx\_id | NONCLUSTERED | NON-UNIQUE | norm\_quarter, id | false | false | 0 | psRsInOutWardQuarter |
| dbo | rs\_inoutward | idx\_norm\_quarter\_com\_id\_norm\_date | NONCLUSTERED | NON-UNIQUE | id, norm\_date, com\_id, norm\_quarter | false | false | 0 | psRsInOutWardQuarter |
| dbo | rs\_inoutward | idx\_rs\_inoutward\_bill\_id\_nc | NONCLUSTERED | NON-UNIQUE | bill\_id, norm\_quarter | false | false | 0 | psRsInOutWardQuarter |
| dbo | rs\_inoutward | idx\_rs\_inoutward\_com\_id\_type\_date | NONCLUSTERED | NON-UNIQUE | total\_amount, payment\_method, supplier\_id, supplier\_name, no2, norm\_quarter, quantity, customer\_name, customer\_id, no, business\_type\_id, date, type, com\_id | false | false | 0 | psRsInOutWardQuarter |
| dbo | rs\_inoutward | idx\_RSInoutward\_comId\_type\_date\_billId | NONCLUSTERED | NON-UNIQUE | com\_id, type, date, bill\_id, type\_desc, quantity, total\_amount, status, norm\_quarter | false | false | 0 | psRsInOutWardQuarter |
| dbo | rs\_inoutward\_detail | PK\_rs\_inoutward\_detail | CLUSTERED | PRIMARY | id, norm\_quarter | true | true | 0 | psRsInOutWardDetailQuarter |
| dbo | rs\_inoutward\_detail | idx\_id | NONCLUSTERED | NON-UNIQUE | id, norm\_quarter | false | false | 0 | psRsInOutWardDetailQuarter |
| dbo | rs\_inoutward\_detail | idx\_rs\_inoutward\_detail\_fromWarehouseId | NONCLUSTERED | NON-UNIQUE | from\_warehouse\_id, norm\_quarter | false | false | 0 | psRsInOutWardDetailQuarter |
| dbo | rs\_inoutward\_detail | idx\_rs\_inoutward\_detail\_ppuId\_rsInoutwardId | NONCLUSTERED | NON-UNIQUE | product\_product\_unit\_id, rs\_inoutward\_id, norm\_quarter | false | false | 0 | psRsInOutWardDetailQuarter |
| dbo | rs\_inoutward\_detail | idx\_rs\_inoutward\_detail\_toWarehouseId | NONCLUSTERED | NON-UNIQUE | norm\_quarter, to\_warehouse\_id | false | false | 0 | psRsInOutWardDetailQuarter |
| dbo | rs\_inoutward\_detail | idx\_rs\_inoutward\_id | NONCLUSTERED | NON-UNIQUE | rs\_inoutward\_id, from\_warehouse\_id, to\_warehouse\_id, batch\_id, norm\_quarter | false | false | 0 | psRsInOutWardDetailQuarter |
| dbo | warehouse | warehouse\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| dbo | warehouse | idx\_com\_id | NONCLUSTERED | NON-UNIQUE | com\_id | false | false | 0 | null |
| ecommerce | bill | bill\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| ecommerce | bill | bill\_pk2 | NONCLUSTERED | UNIQUE | order\_code, com\_id, shop\_id | false | true | 0 | null |
| ecommerce | bill | idx\_bill\_com\_id\_orderStatus\_createTime | NONCLUSTERED | NON-UNIQUE | order\_create\_time, order\_status, com\_id | false | false | 0 | null |
| ecommerce | bill | idx\_bill\_com\_id\_shop\_id | NONCLUSTERED | NON-UNIQUE | com\_id, shop\_id, order\_code, order\_status | false | false | 0 | null |
| ecommerce | bill | idx\_ecommerce\_bill\_comId\_orderCreateTime | NONCLUSTERED | NON-UNIQUE | order\_create\_time, com\_id | false | false | 0 | null |
| ecommerce | bill | uidx\_shop\_id\_order\_code | NONCLUSTERED | UNIQUE | shop\_id, order\_code, order\_status | false | true | 0 | null |
| ecommerce | bill\_product | bill\_product\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| ecommerce | bill\_product | idx\_bill\_product\_bill\_id | NONCLUSTERED | NON-UNIQUE | bill\_id | false | false | 0 | null |
| ecommerce | invoice | invoice\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| ecommerce | invoice | idx\_com\_id\_shop\_id\_order\_code | NONCLUSTERED | NON-UNIQUE | shop\_id, order\_code, com\_id | false | false | 0 | null |
| ecommerce | invoice | idx\_ecommerce\_invoice\_comId\_arisingDate | NONCLUSTERED | NON-UNIQUE | arising\_date, com\_id | false | false | 0 | null |
| ecommerce | invoice | idx\_shop\_id\_order\_code | NONCLUSTERED | UNIQUE | order\_code, shop\_id | false | true | 0 | null |
| ecommerce | invoice | invoice\_pk2 | NONCLUSTERED | UNIQUE | bill\_id, com\_id | false | true | 0 | null |
| ecommerce | invoice\_product | invoice\_product\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| ecommerce | invoice\_product | idx\_invoice\_product\_invoice\_ecommerce\_id | NONCLUSTERED | NON-UNIQUE | invoice\_ecommerce\_id | false | false | 0 | null |
| ecommerce | product | product\_info\_pk | CLUSTERED | PRIMARY | id | true | true | 0 | null |
| ecommerce | product | idx\_product\_item\_com | NONCLUSTERED | NON-UNIQUE | com\_id, item\_id | false | false | 0 | null |
